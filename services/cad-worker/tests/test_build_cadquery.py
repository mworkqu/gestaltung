"""Real builds in the child process. Skipped unless cadquery is installed (the cloud build image)."""

import base64
import time

import pytest

pytest.importorskip("cadquery")

from fastapi.testclient import TestClient  # noqa: E402

from app import executor, main  # noqa: E402

pytestmark = pytest.mark.cadquery

BOARD = {"x": 70, "y": 50, "z": 20}


def enclosure(length, width, height, wall):
    return f"""
import cadquery as cq

# Enclosure, millimetres
LENGTH = {length}
WIDTH = {width}
HEIGHT = {height}
WALL = {wall}

outer = cq.Workplane("XY").box(LENGTH, WIDTH, HEIGHT, centered=(True, True, False))
cavity = (
    cq.Workplane("XY")
    .workplane(offset=WALL)
    .box(LENGTH - 2 * WALL, WIDTH - 2 * WALL, HEIGHT, centered=(True, True, False))
)
result = outer.cut(cavity)
"""


def by_name(res):
    return {c["name"]: c for c in res["checks"]}


def test_good_enclosure_passes_everything():
    res = executor.run_build(enclosure(80, 60, 30, 2), 1.2, BOARD)
    assert res["ok"] is True, res
    checks = by_name(res)
    assert set(checks) == {"valid_solid", "positive_volume", "must_contain_box", "min_wall"}
    assert all(c["pass"] for c in checks.values()), checks
    assert "Fits your board (70 × 50 × 20 mm)" in checks["must_contain_box"]["detail"]
    assert "2.0 mm" in checks["min_wall"]["detail"]
    assert res["bbox"] == {"x": 80.0, "y": 60.0, "z": 30.0}
    expected = 80 * 60 * 30 - 76 * 56 * 28
    assert abs(res["volume_mm3"] - expected) < 1.0
    assert base64.b64decode(res["step_b64"]).lstrip().startswith(b"ISO-10303-21")
    assert len(base64.b64decode(res["stl_b64"])) > 100
    assert res["preview_svg"].lstrip().startswith("<?xml") or "<svg" in res["preview_svg"][:500]


def test_board_turned_90_degrees_fits():
    res = executor.run_build(enclosure(60, 80, 30, 2), 1.2, BOARD)
    assert res["ok"] is True, res
    box = by_name(res)["must_contain_box"]
    assert box["pass"] is True and "turned 90°" in box["detail"]


def test_small_enclosure_fails_must_contain_box():
    res = executor.run_build(enclosure(60, 40, 30, 2), 1.2, BOARD)
    assert res["ok"] is True  # it built; the check reports the problem
    box = by_name(res)["must_contain_box"]
    assert box["pass"] is False
    assert "does not fit" in box["detail"] and "56" in box["detail"]


def test_board_on_standoffs_fits():
    code = enclosure(80, 60, 30, 2).replace(
        "result = outer.cut(cavity)",
        "posts = cq.Workplane('XY').workplane(offset=WALL).pushPoints([(-30, -20), (30, -20), (-30, 20), (30, 20)])"
        ".circle(3).extrude(4)\nresult = outer.cut(cavity).union(posts)",
    )
    res = executor.run_build(code, 1.2, BOARD)
    box = by_name(res)["must_contain_box"]
    assert box["pass"] is True, box
    assert "supports" in box["detail"]


def test_thin_walls_fail_min_wall():
    res = executor.run_build(enclosure(80, 60, 30, 0.8), 1.2, None)
    assert res["ok"] is True, res
    wall = by_name(res)["min_wall"]
    assert wall["pass"] is False and "0.8" in wall["detail"]


def test_single_face_fails_valid_solid():
    code = "import cadquery as cq\nresult = cq.Workplane('XY').rect(20, 10).extrude(5).faces('>Z').val()\n"
    res = executor.run_build(code)
    assert res["ok"] is False
    assert res["step_b64"] == res["stl_b64"] == res["preview_svg"] == ""
    valid = by_name(res)["valid_solid"]
    assert valid["pass"] is False and "no solid" in valid["detail"]


def test_open_shell_fails_valid_solid():
    code = (
        "import cadquery as cq\n"
        "box = cq.Workplane('XY').box(10, 10, 10).val()\n"
        "result = cq.Shell.makeShell(box.Faces()[:5])\n"
    )
    res = executor.run_build(code)
    assert res["ok"] is False
    assert by_name(res)["valid_solid"]["pass"] is False


def test_assembly_result():
    code = (
        "import cadquery as cq\n"
        "a = cq.Workplane().box(10, 10, 10)\n"
        "b = cq.Workplane().box(5, 5, 5)\n"
        "result = cq.Assembly().add(a, name='a').add(b, name='b', loc=cq.Location(cq.Vector(20, 0, 0)))\n"
    )
    res = executor.run_build(code)
    assert res["ok"] is True, res
    assert "2 closed, valid solid pieces" in by_name(res)["valid_solid"]["detail"]


def test_cadhelpers_import():
    code = "import cadhelpers\nresult = cadhelpers.open_box(80, 60, 30, 2)\n"
    res = executor.run_build(code, 1.2, BOARD)
    assert res["ok"] is True, res
    assert by_name(res)["must_contain_box"]["pass"] is True


def test_runtime_error_is_plain_english():
    res = executor.run_build("import cadquery as cq\nW = 10\nresult = cq.Workplane().box(W, D, 5)\n")
    assert res["ok"] is False and res["error"].startswith("Line 3:") and "'D'" in res["error"]


def test_print_goes_to_log():
    res = executor.run_build("import cadquery as cq\nprint('hello', 42)\nresult = cq.Workplane().box(5, 5, 5)\n")
    assert res["ok"] is True and "print: hello 42" in res["log"]


def test_import_os_via_api_returns_ok_false():
    client = TestClient(main.app)
    r = client.post("/build", json={"code": "import os\nresult = os.getcwd()\n", "units": "mm"})
    assert r.status_code == 200
    assert r.json()["ok"] is False and "os" in r.json()["error"]


def test_health_reports_version():
    body = TestClient(main.app).get("/health").json()
    assert body["ok"] is True and body["cadquery"][0].isdigit()


@pytest.mark.slow
def test_infinite_loop_times_out():
    start = time.monotonic()
    res = executor.run_build("import cadquery as cq\nwhile True:\n    pass\nresult = 1\n")
    elapsed = time.monotonic() - start
    assert res["ok"] is False
    assert "longer than" in res["error"]
    assert elapsed < 50, elapsed
