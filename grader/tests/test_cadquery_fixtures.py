"""End-to-end grading on STEP fixtures generated with CadQuery (plan Prompt 6, Step C).

Skipped when cadquery is not installed (it always runs in the Docker build).
"""

import json

import pytest

cq = pytest.importorskip("cadquery")

from fastapi.testclient import TestClient  # noqa: E402

from app import compare, main, measure  # noqa: E402
from tools import make_reference  # noqa: E402

pytestmark = pytest.mark.cadquery

DENSITY = 7850


# ---------------------------------------------------------------- fixtures


def plate():
    return cq.Workplane("XY").box(60, 40, 5).val()


def plate_with_hole(d=20.0):
    return cq.Workplane("XY").box(60, 40, 5).faces(">Z").workplane().center(12, 6).hole(d).val()


def export(shape, path):
    cq.exporters.export(shape, str(path), exportType="STEP")
    return path


def base():
    return cq.Solid.makeBox(40, 20, 10)


def post():
    return cq.Solid.makeBox(10, 10, 50, pnt=cq.Vector(0, 40, 0))


def pin(x=50.0):
    return cq.Solid.makeCylinder(5, 30, pnt=cq.Vector(x, 0, 0))


def compound(*shapes):
    return cq.Compound.makeCompound(list(shapes))


def grade(path, ref, mode="part", **kw):
    m = measure.measurement_or_error(file_path=str(path))
    return compare.grade_measurement(m, ref, mode=mode, density_kg_m3=DENSITY, **kw)


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    d = tmp_path_factory.mktemp("fixtures")
    f = {
        "plate": export(plate(), d / "plate.step"),
        "hole": export(plate_with_hole(), d / "plate_hole.step"),
        "rotated": export(plate_with_hole().rotate((0, 0, 0), (1, 1, 0), 37).translate((123, -45, 67)),
                          d / "rotated.step"),
        "scaled": export(plate_with_hole().scale(1000), d / "scaled.step"),
        "inches": export(plate_with_hole().scale(1 / 25.4), d / "inches.step"),
        "small_hole": export(plate_with_hole(19.0), d / "small_hole.step"),
        "two_bodies": export(compound(plate(), plate().translate((100, 0, 0))), d / "two.step"),
        "asm": export(compound(base(), post(), pin()), d / "asm.step"),
        "asm_missing": export(compound(base(), post()), d / "asm_missing.step"),
        "asm_shuffled": export(compound(pin(), base(), post()), d / "asm_shuffled.step"),
        "asm_moved": export(compound(base(), post(), pin(x=80.0)), d / "asm_moved.step"),
    }
    pdf = d / "drawing.step"
    pdf.write_bytes(b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")
    f["pdf"] = pdf
    empty = d / "empty.step"
    empty.write_bytes(b"")
    f["empty"] = empty
    return f


@pytest.fixture(scope="module")
def ref_hole(files):
    return compare.reference_from_measurement(measure.measure_source(file_path=str(files["hole"])), DENSITY)


@pytest.fixture(scope="module")
def ref_asm(files):
    m = measure.measure_source(file_path=str(files["asm"]))
    return compare.reference_from_measurement(m, DENSITY, ["base", "post", "pin"])


# ---------------------------------------------------------------- measurements


def test_plate_measurements(files):
    m = measure.measure_source(file_path=str(files["plate"]))
    assert m["solids"] == 1 and m["valid"]
    assert m["volume_mm3"] == pytest.approx(12000, rel=1e-6)
    assert m["area_mm2"] == pytest.approx(5800, rel=1e-6)
    v = 12000
    expected = sorted([v * (40**2 + 5**2) / 12, v * (60**2 + 5**2) / 12, v * (60**2 + 40**2) / 12])
    assert m["principal_moments_mm5"] == pytest.approx(expected, rel=1e-6)
    assert m["principal_box_mm"] == pytest.approx([5, 40, 60], abs=0.05)


def test_plate_with_hole_matches_itself(files, ref_hole):
    r = grade(files["hole"], ref_hole, max_points=10)
    assert r["error_code"] is None and r["score"] == 10 and r["passed"]


def test_rotated_and_translated_scores_100(files, ref_hole):
    r = grade(files["rotated"], ref_hole, max_points=100)
    assert r["error_code"] is None
    assert r["score"] == 100, r["details"].get("rel_errors")


def test_rotated_via_api(files, ref_hole, monkeypatch):
    monkeypatch.setenv("GRADER_SECRET", "s")
    monkeypatch.setenv("GRADER_ALLOW_LOCAL_FILES", "1")
    c = TestClient(main.app)
    r = c.post("/grade", headers={"X-Grader-Secret": "s"},
               json={"submission_id": "x", "file_path": str(files["rotated"]), "reference_data": ref_hole})
    assert r.status_code == 200
    assert r.json()["score"] == 100
    assert c.get("/health").json()["ok"] is True


def test_scaled_1000x_wrong_units(files, ref_hole):
    r = grade(files["scaled"], ref_hole)
    assert r["error_code"] == "E_WRONG_UNITS"
    assert r["details"]["units"]["length_factor"] == 1000
    assert "1000 times too big" in r["feedback_en"]


def test_inches_detected(files, ref_hole):
    r = grade(files["inches"], ref_hole)
    assert r["error_code"] == "E_WRONG_UNITS"
    assert r["details"]["units"]["inch"] is True
    assert "inches" in r["feedback_en"]


def test_hole_1mm_too_small_loses_points(files, ref_hole):
    r = grade(files["small_hole"], ref_hole, max_points=100)
    assert r["error_code"] is None
    assert r["score"] < 100
    vol = next(c for c in r["checks"] if c["name"] == "volume")
    assert vol["passed"] is False
    assert "higher than expected" in r["feedback_en"] and "hole diameters" in r["feedback_en"]
    practice = grade(files["small_hole"], ref_hole, mode="practice")
    assert 0 < practice["practice_score"] < 100


def test_two_bodies_multiple_solids(files, ref_hole):
    r = grade(files["two_bodies"], ref_hole)
    assert r["error_code"] == "E_MULTIPLE_SOLIDS"
    assert "2 separate bodies" in r["feedback_en"]


def test_pdf_renamed_step(files, ref_hole):
    assert grade(files["pdf"], ref_hole)["error_code"] == "E_NOT_STEP"


def test_empty_file(files, ref_hole):
    assert grade(files["empty"], ref_hole)["error_code"] == "E_EMPTY"


def test_garbage_after_header_parse_failed(tmp_path, ref_hole):
    f = tmp_path / "broken.step"
    f.write_bytes(b"ISO-10303-21;\nHEADER;\nthis is not really step\n")
    r = grade(f, ref_hole)
    assert r["error_code"] in ("E_PARSE_FAILED", "E_NO_SOLID")


# ---------------------------------------------------------------- assembly


def test_assembly_correct(files, ref_asm):
    r = grade(files["asm"], ref_asm, mode="assembly")
    assert r["error_code"] is None and r["score"] == 100


def test_assembly_one_missing(files, ref_asm):
    r = grade(files["asm_missing"], ref_asm, mode="assembly")
    assert r["details"]["missing_parts"] == ["pin"]
    assert "pin" in r["feedback_en"] and r["score"] < 100


def test_assembly_shuffled_still_matched(files, ref_asm):
    r = grade(files["asm_shuffled"], ref_asm, mode="assembly")
    assert r["score"] == 100


def test_assembly_one_moved_position_message(files, ref_asm):
    r = grade(files["asm_moved"], ref_asm, mode="assembly")
    by = {c["name"]: c for c in r["checks"]}
    assert all(by[f"part:{n}"]["passed"] for n in ("base", "post", "pin"))
    assert by["assembly_position"]["passed"] is False
    assert "positions don't match" in r["feedback_en"]


# ---------------------------------------------------------------- reference tool


def test_make_reference_cli(files, tmp_path, capsys):
    names = tmp_path / "names.json"
    names.write_text(json.dumps(["base", "post", "pin"]), encoding="utf-8")
    assert make_reference.main([str(files["asm"]), "--density", "7850", "--assembly", str(names)]) == 0
    ref = json.loads(capsys.readouterr().out)
    assert ref["solids"] == 3 and [p["name"] for p in ref["parts"]] == ["base", "post", "pin"]
    assert ref["mass_kg"] == pytest.approx(ref["volume_mm3"] * 7850e-9, rel=1e-6)
