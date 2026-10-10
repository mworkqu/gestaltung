"""HTTP contract with the build step mocked. Pure: no cadquery needed."""

import pytest
from fastapi.testclient import TestClient

from app import executor, main

CODE = "import cadquery as cq\nresult = cq.Workplane().box(10, 10, 10)\n"
KEYS = {"ok", "step_b64", "stl_b64", "preview_svg", "bbox", "volume_mm3", "checks", "log"}


@pytest.fixture
def client(monkeypatch):
    calls = []

    def fake_build(code, min_wall_mm=1.2, must_contain_box=None):
        calls.append({"code": code, "min_wall_mm": min_wall_mm, "must_contain_box": must_contain_box})
        res = executor.empty_result("")
        res.pop("error")
        res.update(
            ok=True,
            step_b64="U1RFUA==",
            stl_b64="U1RM",
            preview_svg="<svg/>",
            bbox={"x": 10.0, "y": 10.0, "z": 10.0},
            volume_mm3=1000.0,
            checks=[{"name": "valid_solid", "pass": True, "detail": "One closed, valid solid."}],
        )
        return res

    monkeypatch.setattr(executor, "run_build", fake_build)
    monkeypatch.delenv("CAD_WORKER_TOKEN", raising=False)
    c = TestClient(main.app, raise_server_exceptions=False)
    c.calls = calls
    return c


def test_health_shape(client):
    body = client.get("/health").json()
    assert set(body) == {"ok", "cadquery"}
    assert isinstance(body["ok"], bool) and isinstance(body["cadquery"], str)


def test_build_success_passes_defaults(client):
    r = client.post("/build", json={"code": CODE, "units": "mm", "checks": {}})
    assert r.status_code == 200
    body = r.json()
    assert KEYS <= set(body) and body["ok"] is True and "error" not in body
    assert client.calls == [{"code": CODE, "min_wall_mm": 1.2, "must_contain_box": None}]


def test_build_checks_are_forwarded(client):
    r = client.post(
        "/build",
        json={"code": CODE, "units": "mm", "checks": {"min_wall_mm": 2, "must_contain_box": {"x": 70, "y": 50, "z": 20}}},
    )
    assert r.status_code == 200
    assert client.calls[0]["min_wall_mm"] == 2.0
    assert client.calls[0]["must_contain_box"] == {"x": 70.0, "y": 50.0, "z": 20.0}


def test_checks_object_optional(client):
    assert client.post("/build", json={"code": CODE}).status_code == 200


def test_rejected_code_never_reaches_the_builder(client):
    r = client.post("/build", json={"code": "import os\nresult = 1\n", "units": "mm"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and "os" in body["error"]
    assert body["step_b64"] == body["stl_b64"] == body["preview_svg"] == ""
    assert client.calls == []


def test_wrong_units_is_422_with_contract_shape(client):
    r = client.post("/build", json={"code": CODE, "units": "inch"})
    assert r.status_code == 422
    body = r.json()
    assert KEYS <= set(body) and body["ok"] is False and "units" in body["error"]


def test_bad_box_is_422(client):
    r = client.post("/build", json={"code": CODE, "checks": {"must_contain_box": {"x": -1, "y": 5, "z": 5}}})
    assert r.status_code == 422 and r.json()["ok"] is False


def test_internal_failure_is_500_with_plain_error(client, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(executor, "run_build", boom)
    r = client.post("/build", json={"code": CODE})
    assert r.status_code == 500
    body = r.json()
    assert body["ok"] is False and "secret" not in body["error"]


def test_optional_token(client, monkeypatch):
    monkeypatch.setenv("CAD_WORKER_TOKEN", "s3cret")
    assert client.post("/build", json={"code": CODE}).status_code == 401
    assert client.post("/build", json={"code": CODE}, headers={"X-Cad-Worker-Token": "nope"}).status_code == 401
    r = client.post("/build", json={"code": CODE}, headers={"X-Cad-Worker-Token": "s3cret"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert client.get("/health").status_code == 200  # health stays open


def test_empty_result_shape():
    res = executor.empty_result("nope")
    assert res["ok"] is False and res["error"] == "nope"
    assert res["bbox"] == {"x": 0.0, "y": 0.0, "z": 0.0}


def test_runner_without_cadquery_reports_plainly():
    """Real child process. Without cadquery the runner must still answer in plain English."""
    pytest.importorskip("fastapi")
    try:
        import cadquery  # noqa: F401
    except ImportError:
        res = executor.run_build(CODE)
        assert res["ok"] is False
        assert "not installed" in res["error"]
    else:
        pytest.skip("cadquery is installed; covered by test_build_cadquery.py")


def test_runner_rejects_in_child_too():
    res = executor.run_build("import os\nresult = 1\n")
    assert res["ok"] is False and "os" in res["error"]
