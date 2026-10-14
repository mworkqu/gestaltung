"""Fetch a STEP file, check it, and measure it in a separate, limited process.

The parent never imports cadquery. Parsing runs in a child process with a
wall-clock limit (60 s) and an address-space cap (RLIMIT_AS, Linux); on
overrun the child is killed and the result is E_TIMEOUT.
"""

from __future__ import annotations

import logging
import multiprocessing as mp
import os
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("grader.measure")

MAX_BYTES = int(os.environ.get("GRADER_MAX_FILE_MB", "50")) * 1024 * 1024
DOWNLOAD_TIMEOUT_S = float(os.environ.get("GRADER_DOWNLOAD_TIMEOUT_S", "20"))
PARSE_TIMEOUT_S = float(os.environ.get("GRADER_PARSE_TIMEOUT_S", "60"))
# Extra address space the child may use on top of what it has after cadquery is loaded.
CHILD_EXTRA_MEMORY_MB = int(os.environ.get("GRADER_CHILD_MEMORY_MB", "1200"))
STEP_MAGIC = b"ISO-10303-21"


class GraderError(Exception):
    """A student-facing failure with an error code (see messages.py)."""

    def __init__(self, code: str, **params):
        super().__init__(code)
        self.code = code
        self.params = params


# ---------------------------------------------------------------- loading


def _allowed_url(url: str) -> bool:
    if not url.startswith("https://"):
        return False
    prefixes = [p.strip() for p in os.environ.get("GRADER_ALLOWED_URL_PREFIXES", "").split(",") if p.strip()]
    return not prefixes or any(url.startswith(p) for p in prefixes)


def download(url: str, *, max_bytes: int = MAX_BYTES, timeout_s: float = DOWNLOAD_TIMEOUT_S) -> bytes:
    """GET a signed URL with a size cap and a total time limit. Never logs the URL."""
    import httpx

    if not _allowed_url(url):
        raise GraderError("E_DOWNLOAD_FAILED", reason="url_not_allowed")
    deadline = time.monotonic() + timeout_s
    chunks: list[bytes] = []
    size = 0
    try:
        with httpx.stream("GET", url, timeout=httpx.Timeout(timeout_s), follow_redirects=True) as r:
            if r.status_code != 200:
                raise GraderError("E_DOWNLOAD_FAILED", reason=f"http_{r.status_code}")
            declared = r.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise GraderError("E_TOO_LARGE", max_mb=max_bytes // (1024 * 1024))
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise GraderError("E_TOO_LARGE", max_mb=max_bytes // (1024 * 1024))
                if time.monotonic() > deadline:
                    raise GraderError("E_DOWNLOAD_FAILED", reason="timeout")
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise GraderError("E_DOWNLOAD_FAILED", reason=type(exc).__name__) from None
    return b"".join(chunks)


def read_local(path: str, *, max_bytes: int = MAX_BYTES) -> bytes:
    """Local file (tests and tools only; the API allows it only with GRADER_ALLOW_LOCAL_FILES=1)."""
    p = Path(path)
    if not p.is_file():
        raise GraderError("E_DOWNLOAD_FAILED", reason="no_such_file")
    if p.stat().st_size > max_bytes:
        raise GraderError("E_TOO_LARGE", max_mb=max_bytes // (1024 * 1024))
    return p.read_bytes()


def load(file_url: str | None = None, file_path: str | None = None, *, max_bytes: int = MAX_BYTES) -> bytes:
    if file_path:
        return read_local(file_path, max_bytes=max_bytes)
    if file_url:
        return download(file_url, max_bytes=max_bytes)
    raise GraderError("E_DOWNLOAD_FAILED", reason="no_source")


def check_header(data: bytes) -> None:
    if not data:
        raise GraderError("E_EMPTY")
    head = data[:4096].lstrip(b"\xef\xbb\xbf").lstrip()
    if not head:
        raise GraderError("E_EMPTY")
    if not head.startswith(STEP_MAGIC):
        raise GraderError("E_NOT_STEP")


# ---------------------------------------------------------------- child process


def _limit_memory(extra_mb: int) -> None:
    try:
        import resource
    except ImportError:  # Windows dev machine: only the wall-clock limit applies
        return
    vm = 0
    try:
        with open("/proc/self/status", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("VmSize:"):
                    vm = int(line.split()[1]) * 1024
                    break
    except OSError:
        pass
    limit = vm + extra_mb * 1024 * 1024
    try:
        _soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard != resource.RLIM_INFINITY:
            limit = min(limit, hard)
        resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass


def _child_main(path: str, conn, extra_mb: int) -> None:
    """Parse + measure. Sends {"ok": True, "measurement": ...} or {"ok": False, "code": ...}."""
    try:
        from app import geometry  # preloaded by the forkserver on Linux

        _limit_memory(extra_mb)
        try:
            result = geometry.import_and_measure(path)
        except MemoryError:
            conn.send({"ok": False, "code": "E_TIMEOUT", "reason": "memory"})
            return
        except Exception as exc:  # noqa: BLE001 — any reader failure = unreadable file
            conn.send({"ok": False, "code": "E_PARSE_FAILED", "reason": type(exc).__name__})
            return
        conn.send({"ok": True, "measurement": result})
    except MemoryError:
        try:
            conn.send({"ok": False, "code": "E_TIMEOUT", "reason": "memory"})
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001
        try:
            conn.send({"ok": False, "code": "E_PARSE_FAILED", "reason": type(exc).__name__})
        except Exception:  # noqa: BLE001
            pass
    finally:
        conn.close()


# Tests swap this for a slow function to prove the timeout kills the child.
_CHILD_TARGET = _child_main


@lru_cache(maxsize=1)
def _context():
    method = os.environ.get("GRADER_MP_START") or ("forkserver" if sys.platform.startswith("linux") else "spawn")
    ctx = mp.get_context(method)
    if method == "forkserver":
        ctx.set_forkserver_preload(["app.geometry"])  # cadquery loaded once, reused by every child
    return ctx


def measure_bytes(data: bytes, *, timeout_s: float = PARSE_TIMEOUT_S, extra_mb: int = CHILD_EXTRA_MEMORY_MB) -> dict:
    """Header check + parse + measure. Returns the measurement dict or raises GraderError."""
    check_header(data)
    fd, path = tempfile.mkstemp(suffix=".step", prefix="grade-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        ctx = _context()
        recv, send = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=_CHILD_TARGET, args=(path, send, extra_mb), daemon=True)
        proc.start()
        send.close()
        try:
            if not recv.poll(timeout_s):
                log.warning("parse timed out", extra={"event": "parse_timeout", "timeout_s": timeout_s})
                raise GraderError("E_TIMEOUT")
            try:
                msg = recv.recv()
            except EOFError:
                proc.join(2)
                # Killed by the kernel (memory) or crashed inside OpenCascade.
                code = "E_TIMEOUT" if proc.exitcode in (-9, 137) else "E_PARSE_FAILED"
                raise GraderError(code, reason=f"child_exit_{proc.exitcode}") from None
        finally:
            recv.close()
            if proc.is_alive():
                proc.kill()
            proc.join(5)
        if not msg.get("ok"):
            raise GraderError(msg.get("code", "E_PARSE_FAILED"), reason=msg.get("reason"))
        return msg["measurement"]
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def measure_source(file_url: str | None = None, file_path: str | None = None, **kw) -> dict:
    return measure_bytes(load(file_url, file_path), **kw)


def measurement_or_error(file_url: str | None = None, file_path: str | None = None, **kw) -> dict:
    """Like measure_source, but returns {"error_code", "error_params"} instead of raising."""
    try:
        return measure_source(file_url, file_path, **kw)
    except GraderError as exc:
        return {"error_code": exc.code, "error_params": {k: v for k, v in exc.params.items() if k != "reason"},
                "error_reason": exc.params.get("reason")}
