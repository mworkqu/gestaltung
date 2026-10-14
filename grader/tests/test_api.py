"""HTTP layer: secret check, request validation, error paths (no cadquery needed)."""

import pytest
from fastapi.testclient import TestClient

from app import compare, main
from tests.helpers import box_measurement

SECRET = "test-secret-123"
REF = compare.reference_from_measurement(box_measurement(60, 40, 5), 7850)
AUTH = {"X-Grader-Secret": SECRET}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GRADER_SECRET", SECRET)
    monkeypatch.setenv("GRADER_ALLOW_LOCAL_FILES", "1")
    return TestClient(main.app)


def body(path, **kw):
    return {"submission_id": "s1", "file_path": str(path), "reference_data": REF, "max_points": 10, **kw}


@pytest.fixture
def pdf(tmp_path):
    f = tmp_path / "part.step"
    f.write_bytes(b"%PDF-1.4 not a step")
    return f


def test_health_open(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["service"] == "cad-grader"


def test_missing_and_wrong_secret(client, pdf):
    assert client.post("/grade", json=body(pdf)).status_code == 401
    assert client.post("/grade", json=body(pdf), headers={"X-Grader-Secret": "nope"}).status_code == 401
    assert client.post("/reference", json={"file_path": str(pdf)}).status_code == 401
    pkg_body = {"submission_id": "s", "files": [], "tasks": [{"task_id": "t", "reference_data": REF}]}
    assert client.post("/grade-package", json=pkg_body).status_code == 401


def test_no_secret_configured_fails_closed(monkeypatch, pdf):
    monkeypatch.delenv("GRADER_SECRET", raising=False)
    c = TestClient(main.app)
    assert c.post("/grade", json=body(pdf), headers={"X-Grader-Secret": ""}).status_code == 503


def test_secret_uses_constant_time_compare(monkeypatch, client, pdf):
    calls = []
    real = main.hmac.compare_digest
    monkeypatch.setattr(main.hmac, "compare_digest", lambda a, b: calls.append(1) or real(a, b))
    client.post("/grade", json=body(pdf), headers=AUTH)
    assert calls


def test_not_step_via_api(client, pdf):
    r = client.post("/grade", json=body(pdf), headers=AUTH)
    assert r.status_code == 200
    j = r.json()
    assert j["error_code"] == "E_NOT_STEP" and j["score"] == 0 and j["max_points"] == 10
    assert j["help_slug"] == "my-file-was-rejected" and j["feedback_ar"]
    assert {"score", "max_points", "checks", "error_code", "warnings", "feedback_en", "feedback_ar", "help_slug",
            "timing_ms"} <= set(j)


def test_empty_via_api(client, tmp_path):
    f = tmp_path / "empty.step"
    f.write_bytes(b"")
    assert client.post("/grade", json=body(f), headers=AUTH).json()["error_code"] == "E_EMPTY"


def test_file_path_refused_in_production(monkeypatch, client, pdf):
    monkeypatch.delenv("GRADER_ALLOW_LOCAL_FILES", raising=False)
    assert client.post("/grade", json=body(pdf), headers=AUTH).status_code == 422


def test_bad_reference_is_422(client, pdf):
    bad = {**REF, "principal_moments_mm5": [1, 2]}
    assert client.post("/grade", json=body(pdf, reference_data=bad), headers=AUTH).status_code == 422


def test_package_missing_task_file(client, pdf):
    r = client.post("/grade-package", headers=AUTH, json={
        "submission_id": "s2",
        "files": [{"name": "Results/Parts and Assemblies/Part_01.step", "file_path": str(pdf)},
                  {"name": "Results/Renders/r.png", "file_path": str(pdf)}],
        "tasks": [{"task_id": "t1", "patterns": ["Parts and Assemblies/Part_01.*"], "reference_data": REF},
                  {"task_id": "t2", "patterns": ["Parts and Assemblies/Part_02.*"], "reference_data": REF}],
    })
    assert r.status_code == 200
    j = r.json()
    res = {x["task_id"]: x for x in j["results"]}
    assert res["t1"]["error_code"] == "E_NOT_STEP" and res["t1"]["matched_by"] == "name"
    assert res["t2"]["error_code"] == "E_NO_FILE" and res["t2"]["file_name"] is None
    assert j["ignored_files"] == ["Results/Renders/r.png"]
