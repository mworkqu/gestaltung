"""HTTP API: POST /build, GET /health. Contract in README.md."""

from __future__ import annotations

import hmac
import logging
import os
import threading
from importlib import metadata
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app import executor, sandbox

log = logging.getLogger("cad-worker")

MAX_CONCURRENT = max(1, int(os.environ.get("CAD_MAX_CONCURRENT_BUILDS", "1")))
QUEUE_WAIT_S = float(os.environ.get("CAD_QUEUE_WAIT_S", "50"))
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)

app = FastAPI(title="Gestaltung CAD worker", docs_url=None, redoc_url=None, openapi_url=None)


class Box(BaseModel):
    x: float = Field(gt=0, le=2000)
    y: float = Field(gt=0, le=2000)
    z: float = Field(gt=0, le=2000)


class Checks(BaseModel):
    min_wall_mm: float = Field(default=1.2, gt=0, le=50)
    must_contain_box: Box | None = None


class BuildRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: str = Field(max_length=200_000)
    units: Literal["mm"] = "mm"
    checks: Checks = Field(default_factory=Checks)


def _version() -> str | None:
    try:
        return metadata.version("cadquery")
    except metadata.PackageNotFoundError:
        return None


def _authorised(request: Request) -> bool:
    """Optional shared secret: when CAD_WORKER_TOKEN is set, require header `X-Cad-Worker-Token: <token>`.

    Authorization carries the Google ID token that Cloud Run checks (IAM), so the
    shared secret uses its own header.
    """
    token = os.environ.get("CAD_WORKER_TOKEN", "")
    if not token:
        return True
    given = request.headers.get("x-cad-worker-token", "")
    return hmac.compare_digest(given.encode(), token.encode())


@app.exception_handler(RequestValidationError)
async def _bad_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body") or "request"
    reason = first.get("msg", "is invalid")
    return JSONResponse(status_code=422, content=executor.empty_result(f"The request is invalid: {where} {reason}."))


@app.get("/health")
def health() -> dict:
    version = _version()
    return {"ok": version is not None, "cadquery": version or "not installed"}


@app.post("/build")
def build(body: BuildRequest, request: Request):
    if not _authorised(request):
        return JSONResponse(status_code=401, content=executor.empty_result("Not authorised."))
    try:
        problem = sandbox.check(body.code)
        if problem:
            return executor.empty_result(problem)
        if not _slots.acquire(timeout=QUEUE_WAIT_S):
            return executor.empty_result("The CAD worker is busy. Try again in a minute.")
        try:
            box = body.checks.must_contain_box.model_dump() if body.checks.must_contain_box else None
            return executor.run_build(body.code, body.checks.min_wall_mm, box)
        finally:
            _slots.release()
    except Exception:  # noqa: BLE001 — a true internal failure; never leak details
        log.exception("build failed")
        return JSONResponse(status_code=500, content=executor.empty_result("Internal error in the CAD worker."))
