"""Scoring math with hand-made measurement dicts (no cadquery needed)."""

import copy

import pytest

from app import compare
from tests.helpers import box_measurement

DENSITY = 7850


def ref_of(m, names=None):
    return compare.reference_from_measurement(m, DENSITY, names)


def scaled(m, *, volume=1.0, area=1.0, moments=1.0):
    out = copy.deepcopy(m)
    out["volume_mm3"] *= volume
    out["area_mm2"] *= area
    out["principal_moments_mm5"] = [x * moments for x in out["principal_moments_mm5"]]
    return out


PLATE = box_measurement(60, 40, 5)
REF = ref_of(PLATE)


def test_perfect_part_scores_full_in_aspects_mode():
    r = compare.grade_measurement(PLATE, REF, max_points=10)
    assert r["error_code"] is None
    assert r["score"] == 10
    assert r["passed"] is True
    assert [c["name"] for c in r["checks"]] == ["volume", "surface_area", "principal_moments", "solid_count_validity"]
    assert all(c["expected_hidden"] and c["partial"] == 1 for c in r["checks"])
    assert r["feedback_en"].startswith("Excellent")
    assert r["practice_score"] is None


def test_aspects_mode_is_all_or_nothing_per_check():
    r = compare.grade_measurement(scaled(PLATE, volume=1.01), REF, max_points=100)
    by = {c["name"]: c for c in r["checks"]}
    assert by["volume"]["passed"] is False and by["volume"]["points"] == 0 and by["volume"]["partial"] == 0
    assert by["surface_area"]["points"] == 20
    assert r["score"] == 60
    assert "1.0% higher" in r["feedback_en"]
    assert "أكبر من المتوقع" in r["feedback_ar"]


def test_practice_mode_partial_credit_decays_linearly():
    # volume +1 % with 0.5 % tolerance -> 1 - (0.01-0.005)/(4*0.005) = 0.75
    r = compare.grade_measurement(scaled(PLATE, volume=1.01), REF, mode="practice", max_points=100)
    by = {c["name"]: c for c in r["checks"]}
    assert by["volume"]["partial"] == pytest.approx(0.75)
    assert r["score"] == pytest.approx(40 * 0.75 + 20 + 30 + 10)
    assert r["practice_score"] == pytest.approx(90.0)
    assert r["passed"] is True  # practice pass: volume within 1 %
    assert "Practice check passed" in r["feedback_en"]


def test_practice_zero_at_five_times_tolerance_and_fail():
    r = compare.grade_measurement(scaled(PLATE, volume=0.97), REF, mode="practice")
    by = {c["name"]: c for c in r["checks"]}
    assert by["volume"]["partial"] == 0
    assert r["passed"] is False
    assert "3.0% lower" in r["feedback_en"]


def test_area_and_inertia_messages_when_volume_ok():
    r = compare.grade_measurement(scaled(PLATE, area=1.05, moments=1.05), REF)
    assert "surface area" in r["feedback_en"]
    assert "wrong place" in r["feedback_en"]
    assert r["help_slug"] is None


def test_custom_aspect_mapping():
    aspects = [
        {"aspect_key": "A1", "check": "volume", "max_points": 2},
        {"aspect_key": "A2", "check": "principal_moments", "max_points": 3},
    ]
    r = compare.grade_measurement(scaled(PLATE, volume=1.02), REF, aspects=aspects)
    by = {c["name"]: c for c in r["checks"]}
    assert r["max_points"] == 5
    assert r["score"] == 3
    assert by["volume"]["aspect_key"] == "A1"
    assert by["surface_area"]["aspect_key"] is None and by["surface_area"]["max_points"] == 0


@pytest.mark.parametrize(
    "factor,direction,length",
    [(1e9, "too_big", 1000), (1e6, "too_big", 100), (1e3, "too_big", 10), (1e-9, "too_small", 1000),
     (25.4**3, "too_big", 25.4), (1 / 25.4**3, "too_small", 25.4)],
)
def test_wrong_units_detected(factor, direction, length):
    r = compare.grade_measurement(scaled(PLATE, volume=factor), REF)
    assert r["error_code"] == "E_WRONG_UNITS"
    assert r["help_slug"] == "set-units-to-mm"
    assert r["details"]["units"]["direction"] == direction
    assert r["details"]["units"]["length_factor"] == length
    assert r["score"] == 0


def test_inch_message():
    r = compare.grade_measurement(scaled(PLATE, volume=1 / 25.4**3), REF)
    assert "25.4 times too small" in r["feedback_en"]
    assert "inches" in r["feedback_en"]
    assert "إنش" in r["feedback_ar"]


def test_multiple_solids_rejected_in_part_mode():
    m = copy.deepcopy(PLATE)
    m["solids"] = 2
    r = compare.grade_measurement(m, REF)
    assert r["error_code"] == "E_MULTIPLE_SOLIDS"
    assert "2 separate bodies" in r["feedback_en"]
    assert "جسمًا واحدًا" in r["feedback_ar"]
    assert r["help_slug"] == "my-file-was-rejected"


def test_no_solid():
    m = copy.deepcopy(PLATE)
    m["solids"] = 0
    assert compare.grade_measurement(m, REF)["error_code"] == "E_NO_SOLID"


def test_invalid_geometry_is_a_warning_and_still_measured():
    m = copy.deepcopy(PLATE)
    m["valid"] = False
    r = compare.grade_measurement(m, REF)
    assert r["error_code"] is None
    assert r["warnings"] == ["E_INVALID_GEOMETRY"]
    assert r["checks"]  # still measured
    assert next(c for c in r["checks"] if c["name"] == "solid_count_validity")["passed"] is False
    assert r["help_slug"] == "my-file-was-rejected"


def test_measure_error_passes_through():
    r = compare.grade_measurement({"error_code": "E_NOT_STEP"}, REF, max_points=7)
    assert r["error_code"] == "E_NOT_STEP" and r["score"] == 0 and r["max_points"] == 7
    assert "not a STEP file" in r["feedback_en"]


def test_response_never_contains_reference_values():
    r = compare.grade_measurement(scaled(PLATE, volume=1.2, area=1.1, moments=1.1), REF)
    public = {k: v for k, v in r.items() if k != "details"}
    text = repr(public)
    for value in (REF["volume_mm3"], REF["area_mm2"], *REF["principal_moments_mm5"]):
        assert repr(value) not in text and f"{value:g}" not in text


def test_density_only_scales_mass():
    r = compare.grade_measurement(PLATE, REF, density_kg_m3=2700)
    assert r["score"] == 100  # comparison is at unit density
    assert r["details"]["measured"]["mass_kg"] == pytest.approx(12000 * 2700e-9)


def test_tolerance_override_and_validation():
    r = compare.grade_measurement(scaled(PLATE, volume=1.01), REF, tolerances={"volume": 0.02})
    assert next(c for c in r["checks"] if c["name"] == "volume")["passed"] is True
    with pytest.raises(compare.BadReference):
        compare.grade_measurement(PLATE, REF, tolerances={"volume": 2})


# ---------------------------------------------------------------- assembly


def assembly(parts_boxes, offsets_moments=1.0):
    parts = []
    for i, dims in enumerate(parts_boxes):
        p = box_measurement(*dims)["parts"][0]
        p["index"] = i
        parts.append(p)
    whole = {"solids": len(parts), "valid": True, "invalid_solids": 0,
             "volume_mm3": sum(p["volume_mm3"] for p in parts), "area_mm2": sum(p["area_mm2"] for p in parts),
             "principal_moments_mm5": [1e7 * offsets_moments, 2e7 * offsets_moments, 3e7 * offsets_moments],
             "principal_box_mm": [1, 2, 3], "parts": parts}
    return whole


BOXES = [(40, 20, 10), (10, 10, 50), (30, 5, 5)]
ASM = assembly(BOXES)
ASM_REF = ref_of(ASM, ["base", "post", "pin"])


def test_assembly_correct():
    r = compare.grade_measurement(ASM, ASM_REF, mode="assembly")
    assert r["error_code"] is None
    assert r["score"] == 100 and r["passed"]
    assert "every part is correct" in r["feedback_en"]


def test_assembly_shuffled_order_still_matches():
    shuffled = copy.deepcopy(ASM)
    shuffled["parts"] = [shuffled["parts"][2], shuffled["parts"][0], shuffled["parts"][1]]
    r = compare.grade_measurement(shuffled, ASM_REF, mode="assembly")
    assert r["score"] == 100


def test_assembly_missing_part_named():
    m = assembly([BOXES[0], BOXES[1]])
    r = compare.grade_measurement(m, ASM_REF, mode="assembly")
    assert "pin" in r["feedback_en"] and "missing" in r["feedback_en"]
    by = {c["name"]: c for c in r["checks"]}
    assert by["part:pin"]["passed"] is False and by["parts_count"]["passed"] is False
    assert r["details"]["missing_parts"] == ["pin"]


def test_assembly_extra_part():
    m = assembly([*BOXES, (100, 100, 100)])
    r = compare.grade_measurement(m, ASM_REF, mode="assembly")
    assert "1 extra" in r["feedback_en"]


def test_assembly_moved_part_position_message():
    m = assembly(BOXES, offsets_moments=1.3)
    r = compare.grade_measurement(m, ASM_REF, mode="assembly")
    by = {c["name"]: c for c in r["checks"]}
    assert by["assembly_position"]["passed"] is False
    assert all(by[f"part:{n}"]["passed"] for n in ("base", "post", "pin"))
    assert "positions don't match" in r["feedback_en"]
    assert r["score"] == 80


def test_assembly_needs_parts_in_reference():
    with pytest.raises(compare.BadReference):
        compare.grade_measurement(ASM, {**ASM_REF, "parts": []}, mode="assembly")


def test_reference_part_names_must_match_solids():
    with pytest.raises(compare.BadReference):
        ref_of(ASM, ["only-one"])
