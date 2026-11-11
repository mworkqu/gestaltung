"""Compare a measured STEP file with reference_data and score it. Pure: no cadquery.

Two scoring modes (docs/COMPETITION_ALIGNMENT.md section D):
- "aspects" (competition, default for part/assembly): every check is one
  MEASUREMENT aspect. Inside tolerance = full points, outside = zero.
- "practice" (practice tests and exercises): the partial-credit curve
  (40 % volume, 20 % area, 30 % principal moments, 10 % solid count + validity;
  full inside tolerance, linear decay to 0 at 5x tolerance). Reported as the
  "practice score", plus the practice pass/fail (validity, single solid,
  units, volume within 1 %).

Every comparison uses quantities that do not change when the part is moved or
rotated: volume, surface area and the principal moments of inertia about the
centre of mass (compared at unit density, mm^5, so density never matters).
"""

from __future__ import annotations

import math
from typing import Any

from app import messages as msg

DEFAULT_TOLERANCES: dict[str, float] = {
    "volume": 0.005,  # +/- 0.5 %
    "area": 0.01,  # +/- 1 %
    "moment": 0.01,  # +/- 1 % on each principal moment
    "assembly_match": 0.10,  # a solid pairs with a reference part when volumes are within 10 %
    "practice_volume": 0.01,  # practice pass/fail: volume within 1 %
}

DECAY_FACTOR = 5.0  # partial credit reaches 0 at 5x tolerance

# Practice weights per check (part mode).
PRACTICE_WEIGHTS: dict[str, float] = {
    "volume": 0.40,
    "surface_area": 0.20,
    "principal_moments": 0.30,
    "solid_count_validity": 0.10,
}

# Default aspect split for assembly mode.
ASSEMBLY_WEIGHTS = {"parts": 0.70, "parts_count": 0.10, "assembly_position": 0.20}

# Volume ratio (measured / reference) -> linear scale factor. Inverses too.
UNIT_SCALES: list[tuple[float, float]] = [
    (1e3, 10.0),
    (1e6, 100.0),
    (1e9, 1000.0),
    (25.4**3, 25.4),
]
UNIT_MATCH = 0.05  # ratio within 5 % of a scale counts as "that scale"


class BadReference(ValueError):
    """reference_data is missing something the chosen mode needs."""


# ---------------------------------------------------------------- helpers


def merge_tolerances(overrides: dict[str, Any] | None) -> dict[str, float]:
    tol = dict(DEFAULT_TOLERANCES)
    for key, value in (overrides or {}).items():
        if key in tol and value is not None:
            v = float(value)
            if not (0 < v <= 0.5):
                raise BadReference(f"tolerance {key} must be > 0 and <= 0.5")
            tol[key] = v
    return tol


def rel_err(measured: float, expected: float) -> float:
    """Signed relative error (measured - expected) / expected."""
    if expected == 0:
        return 0.0 if measured == 0 else math.inf
    return (measured - expected) / abs(expected)


def decay(err: float, tol: float) -> float:
    """1 inside tolerance, linear down to 0 at DECAY_FACTOR x tolerance."""
    e = abs(err)
    if e <= tol:
        return 1.0
    span = (DECAY_FACTOR - 1.0) * tol
    return max(0.0, 1.0 - (e - tol) / span)


def detect_units(measured_volume: float, reference_volume: float) -> dict | None:
    """Return the detected wrong-unit scale, or None when the size is plausible."""
    if measured_volume <= 0 or reference_volume <= 0:
        return None
    ratio = measured_volume / reference_volume
    for vol_ratio, length in UNIT_SCALES:
        if abs(ratio / vol_ratio - 1.0) <= UNIT_MATCH:
            return {"direction": "too_big", "length_factor": length, "volume_ratio": vol_ratio, "inch": length == 25.4}
        if abs(ratio * vol_ratio - 1.0) <= UNIT_MATCH:
            return {"direction": "too_small", "length_factor": length, "volume_ratio": 1.0 / vol_ratio, "inch": length == 25.4}
    return None


def with_density(measurement: dict, density_kg_m3: float) -> dict:
    """Add mass (kg) and mass moments (kg*mm^2) to a measurement dict (copy)."""
    m = dict(measurement)
    rho = density_kg_m3 * 1e-9  # kg / mm^3
    m["density_kg_m3"] = density_kg_m3
    m["mass_kg"] = m.get("volume_mm3", 0.0) * rho
    m["principal_moments_kg_mm2"] = [v * rho for v in m.get("principal_moments_mm5", [])]
    parts = []
    for p in m.get("parts", []) or []:
        q = dict(p)
        q["mass_kg"] = q.get("volume_mm3", 0.0) * rho
        q["principal_moments_kg_mm2"] = [v * rho for v in q.get("principal_moments_mm5", [])]
        parts.append(q)
    m["parts"] = parts
    return m


def _round(v: Any, nd: int = 6) -> Any:
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return float(f"{v:.{nd}g}")
    if isinstance(v, list):
        return [_round(x, nd) for x in v]
    if isinstance(v, dict):
        return {k: _round(x, nd) for k, x in v.items()}
    return v


def reference_from_measurement(measurement: dict, density_kg_m3: float, part_names: list[str] | None = None) -> dict:
    """reference_data JSON (make_reference.py and POST /reference)."""
    m = with_density(measurement, density_kg_m3)
    parts_in = m.get("parts", [])
    if part_names is not None and len(part_names) != len(parts_in):
        raise BadReference(f"{len(part_names)} part names given but the file has {len(parts_in)} solids")
    parts = []
    for i, p in enumerate(parts_in):
        parts.append(
            {
                "name": part_names[i] if part_names else f"part_{i + 1}",
                "volume_mm3": p["volume_mm3"],
                "area_mm2": p["area_mm2"],
                "mass_kg": p["mass_kg"],
                "principal_moments_mm5": p["principal_moments_mm5"],
                "principal_moments_kg_mm2": p["principal_moments_kg_mm2"],
                "principal_box_mm": p.get("principal_box_mm"),
            }
        )
    ref = {
        "version": 1,
        "units": "mm",
        "density_kg_m3": density_kg_m3,
        "solids": m["solids"],
        "valid": m.get("valid", True),
        "volume_mm3": m["volume_mm3"],
        "area_mm2": m["area_mm2"],
        "mass_kg": m["mass_kg"],
        "principal_moments_mm5": m["principal_moments_mm5"],
        "principal_moments_kg_mm2": m["principal_moments_kg_mm2"],
        "principal_box_mm": m.get("principal_box_mm"),
        "parts": parts,
    }
    return _round(ref, 9)


# ---------------------------------------------------------------- results


def error_result(code: str, *, max_points: float, timing_ms: int = 0, warnings: list[str] | None = None,
                 mode: str = "part", scoring: str = "aspects", details: dict | None = None, **params) -> dict:
    en, ar = msg.error_message(code, **params)
    return {
        "score": 0.0,
        "max_points": float(max_points),
        "checks": [],
        "error_code": code,
        "warnings": list(warnings or []),
        "feedback_en": en,
        "feedback_ar": ar,
        "help_slug": msg.help_slug(code),
        "timing_ms": int(timing_ms),
        "mode": mode,
        "scoring": scoring,
        "passed": False,
        "practice_score": 0.0 if scoring == "practice" else None,
        "details": {"error_params": _round(params), **(details or {})},
    }


def _aspect_plan(check_names: list[str], default_weights: dict[str, float], max_points: float,
                 aspects: list[dict] | None) -> dict[str, tuple[str | None, float]]:
    """check name -> (aspect_key, max points for that check)."""
    if aspects:
        plan: dict[str, tuple[str | None, float]] = {n: (None, 0.0) for n in check_names}
        for a in aspects:
            check = a.get("check")
            if check in plan:
                plan[check] = (a.get("aspect_key"), float(a.get("max_points", 0.0)))
        return plan
    total_w = sum(default_weights.get(n, 0.0) for n in check_names) or 1.0
    return {n: (n, max_points * default_weights.get(n, 0.0) / total_w) for n in check_names}


def _finish(checks_raw: list[dict], *, scoring: str, max_points: float, aspects: list[dict] | None,
            default_weights: dict[str, float]) -> tuple[list[dict], float, float]:
    """Attach aspect keys and points. Returns (checks, score, max_points_total)."""
    names = [c["name"] for c in checks_raw]
    plan = _aspect_plan(names, default_weights, max_points, aspects)
    total_max = sum(p for _, p in plan.values()) if aspects else float(max_points)
    out, score = [], 0.0
    for c in checks_raw:
        aspect_key, pts = plan[c["name"]]
        fraction = c["practice_fraction"] if scoring == "practice" else (1.0 if c["passed"] else 0.0)
        earned = pts * fraction
        score += earned
        out.append(
            {
                "name": c["name"],
                "measured": _round(c["measured"]),
                "expected_hidden": True,
                "passed": bool(c["passed"]),
                "partial": round(fraction, 4),
                "aspect_key": aspect_key,
                "points": round(earned, 4),
                "max_points": round(pts, 4),
            }
        )
    return out, round(score, 4), round(total_max, 4)


def _need(ref: dict, *keys: str) -> None:
    for k in keys:
        if k not in ref or ref[k] is None:
            raise BadReference(f"reference_data.{k} is missing")


# ---------------------------------------------------------------- part mode


def _part_checks(m: dict, ref: dict, tol: dict[str, float], expected_solids: int) -> tuple[list[dict], dict]:
    v_err = rel_err(m["volume_mm3"], ref["volume_mm3"])
    a_err = rel_err(m["area_mm2"], ref["area_mm2"])
    mom_errs = [rel_err(a, b) for a, b in zip(m["principal_moments_mm5"], ref["principal_moments_mm5"])]
    mom_ok = len(mom_errs) == 3 and all(abs(e) <= tol["moment"] for e in mom_errs)
    mom_frac = sum(decay(e, tol["moment"]) for e in mom_errs) / 3 if len(mom_errs) == 3 else 0.0
    solids_ok = m["solids"] == expected_solids and bool(m.get("valid", True))
    checks = [
        {"name": "volume", "measured": m["volume_mm3"], "passed": abs(v_err) <= tol["volume"],
         "practice_fraction": decay(v_err, tol["volume"])},
        {"name": "surface_area", "measured": m["area_mm2"], "passed": abs(a_err) <= tol["area"],
         "practice_fraction": decay(a_err, tol["area"])},
        {"name": "principal_moments", "measured": m["principal_moments_mm5"], "passed": mom_ok,
         "practice_fraction": mom_frac},
        {"name": "solid_count_validity", "measured": {"solids": m["solids"], "valid": bool(m.get("valid", True))},
         "passed": solids_ok, "practice_fraction": 1.0 if solids_ok else 0.0},
    ]
    errs = {"volume": v_err, "surface_area": a_err, "principal_moments": mom_errs}
    return checks, errs


def _part_feedback(checks: list[dict], errs: dict) -> list[tuple[str, str]]:
    by = {c["name"]: c for c in checks}
    lines: list[tuple[str, str]] = []
    if not by["volume"]["passed"]:
        key = "volume_low" if errs["volume"] < 0 else "volume_high"
        lines.append(msg.render(key, pct=msg.fmt_pct(errs["volume"])))
    else:
        if not by["surface_area"]["passed"]:
            lines.append(msg.render("area_off"))
        if not by["principal_moments"]["passed"]:
            lines.append(msg.render("inertia_off"))
    if not by["solid_count_validity"]["passed"] and by["solid_count_validity"]["measured"]["valid"]:
        lines.append(msg.render("solid_count_wrong"))
    if not lines:
        lines.append(msg.render("all_pass"))
    return lines


# ---------------------------------------------------------------- assembly mode


def _match_parts(parts: list[dict], ref_parts: list[dict], match_tol: float) -> list[tuple[int, int]]:
    """Hungarian assignment of solids to reference parts by relative volume error."""
    if not parts or not ref_parts:
        return []
    from scipy.optimize import linear_sum_assignment  # local import keeps module import cheap

    big = 1e6
    cost = []
    for r in ref_parts:
        row = []
        for p in parts:
            e = abs(rel_err(p["volume_mm3"], r["volume_mm3"]))
            row.append(e if math.isfinite(e) else big)
        cost.append(row)
    rows, cols = linear_sum_assignment(cost)
    return [(int(r), int(c)) for r, c in zip(rows, cols) if cost[r][c] <= match_tol]


def _assembly(m: dict, ref: dict, tol: dict[str, float]) -> tuple[list[dict], list[tuple[str, str]], dict, dict]:
    ref_parts = ref.get("parts") or []
    if not ref_parts:
        raise BadReference("reference_data.parts is missing (assembly mode needs per-part data)")
    parts = m.get("parts") or []
    pairs = _match_parts(parts, ref_parts, tol["assembly_match"])
    matched_ref = {r: c for r, c in pairs}
    used_solids = {c for _, c in pairs}

    checks: list[dict] = []
    missing, wrong = [], []
    part_details = []
    for ri, rp in enumerate(ref_parts):
        name = rp.get("name") or f"part_{ri + 1}"
        if ri not in matched_ref:
            missing.append(name)
            checks.append({"name": f"part:{name}", "measured": None, "passed": False, "practice_fraction": 0.0})
            part_details.append({"name": name, "matched_solid": None})
            continue
        p = parts[matched_ref[ri]]
        v_err = rel_err(p["volume_mm3"], rp["volume_mm3"])
        a_err = rel_err(p["area_mm2"], rp["area_mm2"])
        m_errs = [rel_err(a, b) for a, b in zip(p["principal_moments_mm5"], rp["principal_moments_mm5"])]
        ok = abs(v_err) <= tol["volume"] and abs(a_err) <= tol["area"] and len(m_errs) == 3 and all(
            abs(e) <= tol["moment"] for e in m_errs
        )
        frac = 0.4 * decay(v_err, tol["volume"]) + 0.2 * decay(a_err, tol["area"]) + 0.4 * (
            sum(decay(e, tol["moment"]) for e in m_errs) / 3 if len(m_errs) == 3 else 0.0
        )
        if not ok:
            wrong.append(name)
        checks.append({"name": f"part:{name}", "measured": {"volume_mm3": p["volume_mm3"], "area_mm2": p["area_mm2"]},
                       "passed": ok, "practice_fraction": frac})
        part_details.append({"name": name, "matched_solid": matched_ref[ri], "rel_err_volume": v_err,
                             "rel_err_area": a_err, "rel_err_moments": m_errs})

    extra = [i for i in range(len(parts)) if i not in used_solids]
    count_ok = not missing and not extra and len(parts) == len(ref_parts)
    checks.append({"name": "parts_count", "measured": {"solids": len(parts)}, "passed": count_ok,
                   "practice_fraction": 1.0 if count_ok else 0.0})

    pos_errs = [rel_err(a, b) for a, b in zip(m["principal_moments_mm5"], ref["principal_moments_mm5"])]
    pos_ok = len(pos_errs) == 3 and all(abs(e) <= tol["moment"] for e in pos_errs)
    pos_frac = sum(decay(e, tol["moment"]) for e in pos_errs) / 3 if len(pos_errs) == 3 else 0.0
    checks.append({"name": "assembly_position", "measured": m["principal_moments_mm5"], "passed": pos_ok,
                   "practice_fraction": pos_frac})

    lines: list[tuple[str, str]] = []
    if missing:
        lines.append(msg.render("asm_missing", names=", ".join(missing)))
    if extra:
        lines.append(msg.render("asm_extra", n=len(extra)))
    if wrong:
        lines.append(msg.render("asm_parts_wrong", names=", ".join(wrong)))
    if not lines and not pos_ok:
        lines.append(msg.render("asm_positions"))
    if not lines:
        lines.append(msg.render("asm_all_pass"))

    n_parts = len(ref_parts)
    weights = {f"part:{(rp.get('name') or f'part_{i + 1}')}": ASSEMBLY_WEIGHTS["parts"] / n_parts
               for i, rp in enumerate(ref_parts)}
    weights["parts_count"] = ASSEMBLY_WEIGHTS["parts_count"]
    weights["assembly_position"] = ASSEMBLY_WEIGHTS["assembly_position"]
    details = {"parts": part_details, "missing_parts": missing, "extra_solids": extra,
               "rel_err_assembly_moments": pos_errs}
    return checks, lines, weights, details


# ---------------------------------------------------------------- entry point


def grade_measurement(measurement: dict, reference: dict, *, mode: str = "part", scoring: str | None = None,
                      tolerances: dict | None = None, max_points: float = 100.0, aspects: list[dict] | None = None,
                      density_kg_m3: float = 7850.0, timing_ms: int = 0) -> dict:
    """Score one measurement against reference_data. Never raises for student mistakes."""
    if mode not in ("part", "assembly", "practice"):
        raise BadReference(f"unknown mode {mode}")
    scoring = scoring or ("practice" if mode == "practice" else "aspects")
    if scoring not in ("aspects", "practice"):
        raise BadReference(f"unknown scoring {scoring}")
    tol = merge_tolerances(tolerances)
    _need(reference, "volume_mm3", "area_mm2", "principal_moments_mm5")
    common = {"max_points": max_points, "timing_ms": timing_ms, "mode": mode, "scoring": scoring}

    if measurement.get("error_code"):
        return error_result(measurement["error_code"], **common, **(measurement.get("error_params") or {}))

    m = with_density(measurement, density_kg_m3)
    warnings: list[str] = []
    if not m.get("valid", True):
        warnings.append("E_INVALID_GEOMETRY")

    if m.get("solids", 0) == 0:
        return error_result("E_NO_SOLID", warnings=warnings, **common)

    units = detect_units(m["volume_mm3"], reference["volume_mm3"])
    if units:
        return error_result("E_WRONG_UNITS", warnings=warnings, details={"units": units}, **common, **units)

    expected_solids = int(reference.get("solids") or 1)
    if mode != "assembly" and m["solids"] > expected_solids:
        return error_result("E_MULTIPLE_SOLIDS", warnings=warnings, n=m["solids"], expected=expected_solids, **common)

    details: dict[str, Any] = {"measured": m, "tolerances": tol}
    if mode == "assembly":
        raw, lines, weights, asm_details = _assembly(m, reference, tol)
        details.update(asm_details)
    else:
        raw, errs = _part_checks(m, reference, tol, expected_solids)
        lines = _part_feedback(raw, errs)
        weights = PRACTICE_WEIGHTS
        details["rel_errors"] = errs

    checks, score, total_max = _finish(raw, scoring=scoring, max_points=max_points, aspects=aspects,
                                       default_weights=weights)
    all_passed = all(c["passed"] for c in checks)

    practice_score = None
    passed = all_passed
    if scoring == "practice":
        practice_score = round(100.0 * score / total_max, 2) if total_max > 0 else 0.0
        if mode != "assembly":
            v_err = abs(rel_err(m["volume_mm3"], reference["volume_mm3"]))
            passed = bool(m.get("valid", True)) and m["solids"] == expected_solids and v_err <= tol["practice_volume"]
        lines.append(msg.render("practice_passed" if passed else "practice_failed"))
    if "E_INVALID_GEOMETRY" in warnings:
        lines.append(msg.error_message("E_INVALID_GEOMETRY"))

    en, ar = msg.join(lines)
    return {
        "score": score,
        "max_points": total_max,
        "checks": checks,
        "error_code": None,
        "warnings": warnings,
        "feedback_en": en,
        "feedback_ar": ar,
        "help_slug": msg.help_slug("E_INVALID_GEOMETRY") if warnings else None,
        "timing_ms": int(timing_ms),
        "mode": mode,
        "scoring": scoring,
        "passed": passed,
        "practice_score": practice_score,
        "details": _round(details),
    }
