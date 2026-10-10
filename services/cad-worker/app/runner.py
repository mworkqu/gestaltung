"""Child-process entry: runs ONE model and writes result.json in its cwd.

Started by executor.py as `python -I runner.py` in a fresh temp directory,
with a minimal environment (no secrets), JSON on stdin:
    {"code": str, "min_wall_mm": float, "must_contain_box": {x,y,z} | null}

Layers applied here (see README.md):
  * the static check (sandbox.validate) runs again;
  * resource limits: CPU 40 s, address space +1.5 GB over what the CAD engine
    needs to load, 64 open files, 100 MB per written file, no core dumps;
  * network off: socket creation / connection / DNS raise before the model runs;
  * the model runs with restricted builtins and an import hook that only
    returns cadquery, math and cadhelpers;
  * output files are written here, by us, with cadquery's exporters.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)  # -I (isolated mode) does not add the script's folder

import sandbox  # noqa: E402

CPU_SECONDS = 40
EXTRA_ADDRESS_SPACE = 1536 * 1024 * 1024
MAX_OPEN_FILES = 64
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_LOG_CHARS = 8000

STEP_NAME, STL_NAME, SVG_NAME, RESULT_NAME = "model.step", "model.stl", "preview.svg", "result.json"

SAFE_BUILTIN_NAMES = (
    "abs all any bool dict divmod enumerate filter float frozenset int isinstance len list map max min "
    "pow range reversed round set slice sorted str sum tuple zip "
    "Exception ValueError TypeError ArithmeticError ZeroDivisionError IndexError KeyError "
    "StopIteration AssertionError NotImplementedError RuntimeError"
).split()


class Log:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.size = 0

    def add(self, text: str) -> None:
        if self.size >= MAX_LOG_CHARS:
            return
        text = text[: MAX_LOG_CHARS - self.size]
        self.lines.append(text)
        self.size += len(text) + 1

    def text(self) -> str:
        return "\n".join(self.lines)


def apply_limits(log: Log) -> None:
    try:
        import resource
    except ImportError:  # Windows dev machine: no rlimits; the parent's timeout still applies
        log.add("resource limits: not available on this platform")
        return

    def setl(kind, soft, hard=None):
        hard = soft if hard is None else hard
        try:
            cur_soft, cur_hard = resource.getrlimit(kind)
            if cur_hard != resource.RLIM_INFINITY:
                hard = min(hard, cur_hard)
                soft = min(soft, hard)
            resource.setrlimit(kind, (soft, hard))
        except (ValueError, OSError) as exc:
            log.add(f"resource limit {kind} not set: {exc}")

    vm = 0
    try:
        with open("/proc/self/status", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("VmSize:"):
                    vm = int(line.split()[1]) * 1024
                    break
    except OSError:
        pass
    setl(resource.RLIMIT_CPU, CPU_SECONDS, CPU_SECONDS + 5)
    setl(resource.RLIMIT_AS, vm + EXTRA_ADDRESS_SPACE)
    setl(resource.RLIMIT_NOFILE, MAX_OPEN_FILES)
    setl(resource.RLIMIT_FSIZE, MAX_FILE_BYTES)
    setl(resource.RLIMIT_CORE, 0)


def block_network() -> None:
    import socket

    def deny(*_a, **_k):
        raise OSError("network access is disabled in the CAD sandbox")

    class DeniedSocket:  # replaces the class so even socket.socket(...) fails
        def __new__(cls, *_a, **_k):
            deny()

    socket.socket = DeniedSocket  # type: ignore[misc,assignment]
    for name in ("create_connection", "create_server", "getaddrinfo", "gethostbyname",
                 "gethostbyname_ex", "gethostbyaddr", "socketpair", "fromfd"):
        if hasattr(socket, name):
            setattr(socket, name, deny)
    try:
        import _socket

        _socket.socket = DeniedSocket  # type: ignore[misc,assignment]
        for name in ("getaddrinfo", "gethostbyname", "socketpair"):
            if hasattr(_socket, name):
                setattr(_socket, name, deny)
    except ImportError:
        pass


def make_namespace(modules: dict, log: Log) -> dict:
    import builtins

    safe = {name: getattr(builtins, name) for name in SAFE_BUILTIN_NAMES}
    safe["True"], safe["False"], safe["None"] = True, False, None

    def safe_print(*args, sep=" ", end="", **_k):
        log.add("print: " + sep.join(str(a) for a in args) + (end if end != "\n" else ""))

    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
        if level != 0 or name not in modules:
            raise ImportError(f"importing {name!r} is not allowed")
        return modules[name]

    safe["print"] = safe_print
    safe["__import__"] = safe_import
    return {"__builtins__": safe, "__name__": "__model__"}


def model_line(exc: BaseException) -> int | None:
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == "<model>":
            line = frame.lineno
    return line


def explain(exc: BaseException) -> str:
    """A plain-English error for an exception raised while running the model."""
    line = model_line(exc)
    where = f"Line {line}: " if line else ""
    name = type(exc).__name__
    msg = " ".join(str(exc).split())[:300]
    if isinstance(exc, MemoryError):
        return "The model used too much memory while building. Simplify it (fewer features or smaller arrays)."
    if isinstance(exc, RecursionError):
        return f"{where}the model calls itself too deeply (recursion). Use a loop instead."
    if isinstance(exc, ImportError):
        return f"{where}{msg}. Only cadquery, math and cadhelpers can be imported."
    if isinstance(exc, NameError):
        return f"{where}{msg}. Define every dimension before using it."
    if name in ("StdFail_NotDone", "Standard_Failure", "Standard_ConstructionError", "Standard_DomainError") or "BRep" in msg:
        return (
            f"{where}a CAD operation failed ({name}). This is usually a fillet or chamfer that is too big "
            "for its edge, or a boolean between shapes that only touch. Make the radius smaller or let "
            "cutting bodies overshoot by 0.5 mm."
        )
    if isinstance(exc, ZeroDivisionError):
        return f"{where}a division by zero. Check the dimensions."
    if not msg:
        return f"{where}the model failed to build ({name})."
    return f"{where}{msg} ({name})."


def run(request: dict) -> dict:
    log = Log()
    out: dict = {"ok": False, "checks": [], "bbox": None, "volume_mm3": 0.0, "files": False, "error": None}
    t0 = time.monotonic()
    try:
        tree = sandbox.validate(request.get("code", ""))
    except sandbox.Rejected as exc:
        out["error"] = str(exc)
        out["log"] = log.text()
        return out

    import math

    import cadquery as cq

    import cadhelpers
    import geometry

    log.add(f"cadquery {getattr(cq, '__version__', '?')} loaded in {time.monotonic() - t0:.1f} s")
    apply_limits(log)
    block_network()
    namespace = make_namespace({"cadquery": cq, "math": math, "cadhelpers": cadhelpers}, log)

    t1 = time.monotonic()
    try:
        code = compile(tree, "<model>", "exec")
        exec(code, namespace)  # noqa: S102 — checked code, restricted builtins, child process
    except BaseException as exc:  # noqa: BLE001 — anything the model raises becomes a plain error
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            out["error"] = "The model stopped the build."
        else:
            out["error"] = explain(exc)
        out["log"] = log.text()
        return out
    log.add(f"model ran in {time.monotonic() - t1:.1f} s")

    t2 = time.monotonic()
    try:
        shape = geometry.to_shape(namespace.get("result"))
        valid, solids = geometry.check_valid_solid(shape)
        volume, vol = geometry.check_volume(shape)
        checks = [valid, volume]
        out["volume_mm3"] = round(vol, 1)
        bb = None
        try:
            bb, out["bbox"] = geometry.bbox_of(shape)
        except Exception as exc:  # noqa: BLE001
            log.add(f"bounding box failed: {exc}")
        usable = valid["pass"] and volume["pass"] and bb is not None
        if usable:
            box = request.get("must_contain_box")
            if box:
                checks.append(geometry.check_contains_box(shape, solids, bb, box))
            checks.append(geometry.check_min_wall(shape, solids, float(request.get("min_wall_mm") or 1.2)))
        out["checks"] = checks
        log.add(f"checks took {time.monotonic() - t2:.1f} s")
        if not usable:
            failed = next((c for c in checks if not c["pass"]), None)
            out["error"] = failed["detail"] if failed else "The model could not be measured."
            out["log"] = log.text()
            return out

        t3 = time.monotonic()
        geometry.export_all(shape, STEP_NAME, STL_NAME, SVG_NAME)
        log.add(f"exported STEP, STL and preview in {time.monotonic() - t3:.1f} s")
        out["files"] = True
        out["ok"] = True
    except geometry.BuildError as exc:
        out["error"] = str(exc)
    except MemoryError:
        out["error"] = "The model used too much memory while being checked. Simplify it."
    except Exception as exc:  # noqa: BLE001
        log.add("internal: " + "".join(traceback.format_exception_only(type(exc), exc)).strip()[:500])
        out["error"] = f"The model was built but could not be checked or exported ({type(exc).__name__})."
    out["log"] = log.text()
    return out


def main() -> int:
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        request = {}
    try:
        result = run(request)
    except ImportError as exc:
        result = {"ok": False, "error": f"The CAD engine is not installed on this worker ({exc.name}).",
                  "checks": [], "bbox": None, "volume_mm3": 0.0, "files": False, "log": ""}
    except MemoryError:
        result = {"ok": False, "error": "The model used too much memory while building. Simplify it.",
                  "checks": [], "bbox": None, "volume_mm3": 0.0, "files": False, "log": ""}
    with open(RESULT_NAME, "w", encoding="utf-8") as fh:
        json.dump(result, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
