"""Runs one model in a child process and turns the outcome into the response.

Pure standard library (no cadquery import), so the API tests can mock it.
The child is `python -I runner.py` in a fresh temp directory with a minimal
environment (no secrets, one thread per math library); it is killed — with
its whole process group on Linux — after the wall timeout, and the temp
directory is always removed.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

RUNNER = Path(__file__).with_name("runner.py")
WALL_TIMEOUT_S = float(os.environ.get("CAD_BUILD_TIMEOUT_S", "45"))
MAX_RESPONSE_FILE_BYTES = 30 * 1024 * 1024  # Cloud Run responses are capped at 32 MB
MAX_STDERR_CHARS = 2000

TIMEOUT_ERROR = (
    "The model took longer than {s:g} seconds to build, so it was stopped. "
    "Simplify it: fewer features, no loops that never end."
)


def empty_result(error: str, log: str = "") -> dict:
    return {
        "ok": False,
        "step_b64": "",
        "stl_b64": "",
        "preview_svg": "",
        "bbox": {"x": 0.0, "y": 0.0, "z": 0.0},
        "volume_mm3": 0.0,
        "checks": [],
        "log": log,
        "error": error,
    }


def _child_env(tmp: str) -> dict:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": tmp,
        "TMPDIR": tmp,
        "TEMP": tmp,
        "TMP": tmp,
        "LANG": "C.UTF-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8",
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "MPLCONFIGDIR": tmp,
        "XDG_CACHE_HOME": tmp,
    }
    if os.name == "nt":  # Python on Windows needs these to start
        for key in ("SYSTEMROOT", "WINDIR", "COMSPEC"):
            if key in os.environ:
                env[key] = os.environ[key]
    return env


def _kill(proc: subprocess.Popen) -> None:
    try:
        if os.name != "nt":
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


def _crash_error(returncode: int) -> str:
    if os.name != "nt" and returncode < 0:
        sig = -returncode
        if sig == getattr(signal, "SIGXCPU", -1):
            return TIMEOUT_ERROR.format(s=WALL_TIMEOUT_S)
        if sig == getattr(signal, "SIGXFSZ", -1):
            return "The model's output files grew too large (over 100 MB). Simplify it."
        if sig in (signal.SIGKILL, getattr(signal, "SIGSEGV", -1), getattr(signal, "SIGABRT", -1)):
            return "The CAD engine crashed while building this model (often it ran out of memory). Simplify it."
    return "The CAD engine stopped without a result. Simplify the model and try again."


def _read_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii") if path.is_file() else ""


def _clean_checks(raw) -> list[dict]:
    out = []
    if isinstance(raw, list):
        for c in raw[:20]:
            if isinstance(c, dict) and isinstance(c.get("name"), str):
                out.append({"name": c["name"][:40], "pass": bool(c.get("pass")), "detail": str(c.get("detail", ""))[:500]})
    return out


def run_build(code: str, min_wall_mm: float = 1.2, must_contain_box: dict | None = None) -> dict:
    tmp = tempfile.mkdtemp(prefix="cad-build-")
    try:
        payload = json.dumps(
            {"code": code, "min_wall_mm": min_wall_mm, "must_contain_box": must_contain_box}
        ).encode("utf-8")
        proc = subprocess.Popen(  # noqa: S603 — our own interpreter + our own runner script
            [sys.executable, "-I", str(RUNNER)],
            cwd=tmp,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_child_env(tmp),
            start_new_session=(os.name != "nt"),
        )
        try:
            _out, err = proc.communicate(payload, timeout=WALL_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            _kill(proc)
            try:
                proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            return empty_result(TIMEOUT_ERROR.format(s=WALL_TIMEOUT_S))

        stderr_tail = err.decode("utf-8", "replace")[-MAX_STDERR_CHARS:] if err else ""
        result_path = Path(tmp, "result.json")
        if not result_path.is_file():
            return empty_result(_crash_error(proc.returncode), stderr_tail)
        try:
            data = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return empty_result("The CAD engine returned an unreadable result.", stderr_tail)
        if not isinstance(data, dict):
            return empty_result("The CAD engine returned an unreadable result.", stderr_tail)

        log = str(data.get("log") or "")
        if stderr_tail.strip():
            log = (log + "\n--- engine messages ---\n" + stderr_tail).strip()
        res = empty_result(str(data.get("error") or ""), log)
        res["checks"] = _clean_checks(data.get("checks"))
        bbox = data.get("bbox")
        if isinstance(bbox, dict):
            res["bbox"] = {k: float(bbox.get(k) or 0.0) for k in ("x", "y", "z")}
        try:
            res["volume_mm3"] = float(data.get("volume_mm3") or 0.0)
        except (TypeError, ValueError):
            res["volume_mm3"] = 0.0

        if data.get("ok") and data.get("files"):
            step, stl, svg = Path(tmp, "model.step"), Path(tmp, "model.stl"), Path(tmp, "preview.svg")
            sizes = sum(p.stat().st_size for p in (step, stl, svg) if p.is_file())
            if sizes > MAX_RESPONSE_FILE_BYTES:
                res["error"] = "The model is too detailed to send back (files over 30 MB). Simplify it."
                return res
            if not (step.is_file() and stl.is_file()):
                res["error"] = "The model was built but its files were not written."
                return res
            res["step_b64"] = _read_b64(step)
            res["stl_b64"] = _read_b64(stl)
            res["preview_svg"] = svg.read_text(encoding="utf-8", errors="replace") if svg.is_file() else ""
            res["ok"] = True
            res.pop("error", None)
        elif not res["error"]:
            res["error"] = "The model could not be built."
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
