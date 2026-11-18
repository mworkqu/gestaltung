"""CAD Champions STEP grader: GET /health, POST /grade, POST /reference, POST /grade-package.

Contract in README.md. Every POST needs header X-Grader-Secret = env GRADER_SECRET
(constant-time compare). No secret configured = every POST is refused (fail closed).
Responses carry `details` (reference-relative data); the site keeps it server-side
and never shows it to students.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import sys
import threading
import time
from importlib import metadata
from typing import Any, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app import compare, measure, messages
from app import package as pkg


# ---------------------------------------------------------------- logging


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Only whitelisted extra fields; never file contents or URLs."""

    FIELDS = ("event", "submission_id", "task_id", "mode", "scoring", "error_code", "reason", "score",
              "max_points", "timing_ms", "files", "timeout_s", "status")

    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {"severity": record.levelname, "logger": record.name, "message": record.getMessage()}
        for f in self.FIELDS:
            if hasattr(record, f):
                out[f] = getattr(record, f)
        if record.exc_info:
            out["exception"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(out, ensure_ascii=False)


def _setup_logging() -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(os.environ.get("GRADER_LOG_LEVEL", "INFO"))


_setup_logging()
log = logging.getLogger("grader")

MAX_PARALLEL = max(1, int(os.environ.get("GRADER_MAX_PARALLEL", "2")))
QUEUE_WAIT_S = float(os.environ.get("GRADER_QUEUE_WAIT_S", "50"))
MAX_PACKAGE_FILES = int(os.environ.get("GRADER_MAX_PACKAGE_FILES", "40"))
_slots = threading.BoundedSemaphore(MAX_PARALLEL)

app = FastAPI(title="CAD Champions STEP grader", docs_url=None, redoc_url=None, openapi_url=None)


# ---------------------------------------------------------------- models


class Tolerances(BaseModel):
    model_config = ConfigDict(extra="ignore")
    volume: float | None = Field(default=None, gt=0, le=0.5)
    area: float | None = Field(default=None, gt=0, le=0.5)
    moment: float | None = Field(default=None, gt=0, le=0.5)
    assembly_match: float | None = Field(default=None, gt=0, le=0.5)
    practice_volume: float | None = Field(default=None, gt=0, le=0.5)


class AspectMap(BaseModel):
    """Maps one grader check to one measurement aspect (cc_task_aspects)."""

    aspect_key: str = Field(max_length=200)
    check: str = Field(max_length=200)  # volume | surface_area | principal_moments | solid_count_validity |
    #                                      part:<name> | parts_count | assembly_position
    max_points: float = Field(ge=0, le=10_000)


class ReferencePart(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str = Field(max_length=200)
    volume_mm3: float = Field(gt=0)
    area_mm2: float = Field(gt=0)
    principal_moments_mm5: list[float] = Field(min_length=3, max_length=3)


class ReferenceData(BaseModel):
    model_config = ConfigDict(extra="allow")
    volume_mm3: float = Field(gt=0)
    area_mm2: float = Field(gt=0)
    principal_moments_mm5: list[float] = Field(min_length=3, max_length=3)
    solids: int = Field(default=1, ge=1, le=500)
    parts: list[ReferencePart] = Field(default_factory=list, max_length=500)


class Source(BaseModel):
    file_url: str | None = Field(default=None, max_length=4000)
    file_path: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _one_source(self):
        if not self.file_url and not self.file_path:
            raise ValueError("file_url is required")
        return self


class GradeRequest(Source):
    model_config = ConfigDict(extra="ignore")
    submission_id: str = Field(max_length=200)
    mode: Literal["part", "assembly", "practice"] = "part"
    scoring: Literal["aspects", "practice"] | None = None
    reference_data: ReferenceData
    density_kg_m3: float = Field(default=7850, gt=0, le=30_000)
    tolerances: Tolerances | None = None
    max_points: float = Field(default=100, ge=0, le=10_000)
    aspects: list[AspectMap] | None = Field(default=None, max_length=200)


class ReferenceRequest(Source):
    model_config = ConfigDict(extra="ignore")
    density_kg_m3: float = Field(default=7850, gt=0, le=30_000)
    part_names: list[str] | None = Field(default=None, max_length=500)


class PackageFile(Source):
    name: str = Field(max_length=500)  # path inside the ZIP, e.g. "DAY 01/Results/Parts and Assemblies/Part_03.step"


class PackageTask(BaseModel):
    model_config = ConfigDict(extra="ignore")
    task_id: str = Field(max_length=200)
    patterns: list[str] = Field(default_factory=list, max_length=20)
    mode: Literal["part", "assembly", "practice"] = "part"
    scoring: Literal["aspects", "practice"] | None = None
    reference_data: ReferenceData
    density_kg_m3: float | None = Field(default=None, gt=0, le=30_000)
    tolerances: Tolerances | None = None
    max_points: float = Field(default=100, ge=0, le=10_000)
    aspects: list[AspectMap] | None = Field(default=None, max_length=200)


class GradePackageRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    submission_id: str = Field(max_length=200)
    files: list[PackageFile] = Field(max_length=500)
    tasks: list[PackageTask] = Field(min_length=1, max_length=100)
    density_kg_m3: float = Field(default=7850, gt=0, le=30_000)


class Check(BaseModel):
    name: str
    measured: Any = None
    expected_hidden: bool = True
    passed: bool
    partial: float
    aspect_key: str | None = None
    points: float = 0.0
    max_points: float = 0.0


class GradeResponse(BaseModel):
    score: float
    max_points: float
    checks: list[Check]
    error_code: str | None
    warnings: list[str]
    feedback_en: str
    feedback_ar: str
    help_slug: str | None
    timing_ms: int
    mode: str
    scoring: str
    passed: bool
    practice_score: float | None = None
    details: dict[str, Any] = Field(default_factory=dict)  # SERVER-SIDE ONLY: never show to students


class PackageTaskResult(GradeResponse):
    task_id: str
    file_name: str | None = None
    matched_by: str | None = None
    matched_by_volume: bool = False


class GradePackageResponse(BaseModel):
    submission_id: str
    results: list[PackageTaskResult]
    unmatched_files: list[str]
    ignored_files: list[str]
    timing_ms: int


# ---------------------------------------------------------------- helpers


class SecretRefused(Exception):
    def __init__(self, status_code: int, error: str):
        self.status_code = status_code
        self.error = error


def require_secret(request: Request) -> None:
    """FastAPI dependency: runs before request-body validation, so no secret = 401, never 422."""
    secret = os.environ.get("GRADER_SECRET", "")
    if not secret:
        raise SecretRefused(503, "grader_not_configured")
    given = request.headers.get("x-grader-secret", "")
    if not hmac.compare_digest(given.encode("utf-8"), secret.encode("utf-8")):
        raise SecretRefused(401, "unauthorised")


def _local_files_allowed() -> bool:
    return os.environ.get("GRADER_ALLOW_LOCAL_FILES", "") == "1"


def _check_source(src: Source) -> JSONResponse | None:
    if src.file_path and not _local_files_allowed():
        return JSONResponse(status_code=422, content={"error": "file_path is only allowed in tests"})
    return None


def _cadquery_version() -> str | None:
    try:
        return metadata.version("cadquery")
    except metadata.PackageNotFoundError:
        return None


def _measure(src: Source) -> dict:
    if not _slots.acquire(timeout=QUEUE_WAIT_S):
        return {"error_code": "E_TIMEOUT", "error_params": {}, "error_reason": "busy"}
    try:
        return measure.measurement_or_error(src.file_url, src.file_path)
    finally:
        _slots.release()


def _grade(measurement: dict, *, reference: ReferenceData, mode: str, scoring: str | None, tolerances: Tolerances | None,
           max_points: float, aspects: list[AspectMap] | None, density: float, started: float) -> dict:
    return compare.grade_measurement(
        measurement,
        reference.model_dump(),
        mode=mode,
        scoring=scoring,
        tolerances=tolerances.model_dump() if tolerances else None,
        max_points=max_points,
        aspects=[a.model_dump() for a in aspects] if aspects else None,
        density_kg_m3=density,
        timing_ms=int((time.monotonic() - started) * 1000),
    )


# ---------------------------------------------------------------- routes


@app.exception_handler(SecretRefused)
async def _secret_refused(_request: Request, exc: SecretRefused) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.error})


@app.exception_handler(RequestValidationError)
async def _bad_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body") or "request"
    return JSONResponse(status_code=422, content={"error": f"{where}: {first.get('msg', 'is invalid')}"})


@app.get("/health")
def health() -> dict:
    version = _cadquery_version()
    return {"ok": version is not None, "cadquery": version or "not installed", "service": "cad-grader"}


@app.post("/grade", response_model=GradeResponse, dependencies=[Depends(require_secret)])
def grade(body: GradeRequest, request: Request):
    problem = _check_source(body)
    if problem:
        return problem
    started = time.monotonic()
    try:
        m = _measure(body)
        result = _grade(m, reference=body.reference_data, mode=body.mode, scoring=body.scoring,
                        tolerances=body.tolerances, max_points=body.max_points, aspects=body.aspects,
                        density=body.density_kg_m3, started=started)
    except compare.BadReference as exc:
        return JSONResponse(status_code=422, content={"error": str(exc)})
    except Exception:  # noqa: BLE001 — never leak internals
        log.exception("grade failed", extra={"event": "grade_failed", "submission_id": body.submission_id})
        return JSONResponse(status_code=500, content={"error": "internal_error"})
    log.info("graded", extra={"event": "graded", "submission_id": body.submission_id, "mode": result["mode"],
                              "scoring": result["scoring"], "error_code": result["error_code"],
                              "reason": m.get("error_reason"), "score": result["score"],
                              "max_points": result["max_points"], "timing_ms": result["timing_ms"]})
    return result


@app.post("/reference", dependencies=[Depends(require_secret)])
def reference(body: ReferenceRequest, request: Request):
    problem = _check_source(body)
    if problem:
        return problem
    started = time.monotonic()
    m = _measure(body)
    if m.get("error_code"):
        en, ar = messages.error_message(m["error_code"], **(m.get("error_params") or {}))
        return JSONResponse(status_code=422, content={"error_code": m["error_code"], "feedback_en": en,
                                                      "feedback_ar": ar})
    if m.get("solids", 0) == 0:
        return JSONResponse(status_code=422, content={"error_code": "E_NO_SOLID"})
    try:
        ref = compare.reference_from_measurement(m, body.density_kg_m3, body.part_names)
    except compare.BadReference as exc:
        return JSONResponse(status_code=422, content={"error": str(exc)})
    timing = int((time.monotonic() - started) * 1000)
    log.info("reference built", extra={"event": "reference", "timing_ms": timing})
    return {"reference_data": ref, "warnings": [] if m.get("valid", True) else ["E_INVALID_GEOMETRY"],
            "timing_ms": timing}


@app.post("/grade-package", response_model=GradePackageResponse, dependencies=[Depends(require_secret)])
def grade_package(body: GradePackageRequest, request: Request):
    for f in body.files:
        p = _check_source(f)
        if p:
            return p
    step_files = [f for f in body.files if pkg.is_step_name(f.name)]
    if len(step_files) > MAX_PACKAGE_FILES:
        return JSONResponse(status_code=422, content={"error": f"too many STEP files (max {MAX_PACKAGE_FILES})"})
    started = time.monotonic()
    try:
        measured: dict[str, dict] = {}
        for f in step_files:
            measured[f.name] = _measure(f)
        volumes = {name: (m.get("volume_mm3") if not m.get("error_code") else None) for name, m in measured.items()}
        specs = [pkg.TaskSpec(t.task_id, t.patterns, t.reference_data.volume_mm3) for t in body.tasks]
        match = pkg.match_package([f.name for f in body.files], specs, volumes)

        results = []
        for t in body.tasks:
            a = match.assignments[t.task_id]
            density = t.density_kg_m3 or body.density_kg_m3
            if a.file is None:
                r = compare.error_result("E_NO_FILE", max_points=t.max_points, mode=t.mode,
                                         scoring=t.scoring or ("practice" if t.mode == "practice" else "aspects"))
            else:
                r = _grade(measured[a.file], reference=t.reference_data, mode=t.mode, scoring=t.scoring,
                           tolerances=t.tolerances, max_points=t.max_points, aspects=t.aspects, density=density,
                           started=started)
                if a.matched_by_volume:
                    en, ar = messages.render("matched_by_volume", file=a.file.rsplit("/", 1)[-1])
                    r["feedback_en"] = f"{en} {r['feedback_en']}"
                    r["feedback_ar"] = f"{ar} {r['feedback_ar']}"
                    r["warnings"] = [*r["warnings"], "MATCHED_BY_VOLUME"]
                if a.ambiguous:
                    r["details"] = {**r.get("details", {}), "also_matched_by_name": a.ambiguous}
            results.append({**r, "task_id": t.task_id, "file_name": a.file, "matched_by": a.matched_by,
                            "matched_by_volume": a.matched_by_volume})
    except compare.BadReference as exc:
        return JSONResponse(status_code=422, content={"error": str(exc)})
    except Exception:  # noqa: BLE001
        log.exception("package failed", extra={"event": "package_failed", "submission_id": body.submission_id})
        return JSONResponse(status_code=500, content={"error": "internal_error"})
    timing = int((time.monotonic() - started) * 1000)
    log.info("package graded", extra={"event": "package_graded", "submission_id": body.submission_id,
                                      "files": len(step_files), "timing_ms": timing})
    return {"submission_id": body.submission_id, "results": results, "unmatched_files": match.unmatched_files,
            "ignored_files": match.ignored_files, "timing_ms": timing}
