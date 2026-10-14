"""Module-level helpers the parse child can import (spawn/forkserver pickle by name)."""

import time


def slow_child(path, conn, extra_mb):  # same signature as measure._child_main
    time.sleep(30)  # a "pathological" file that never finishes parsing
    conn.close()


def crashing_child(path, conn, extra_mb):
    conn.send({"ok": False, "code": "E_PARSE_FAILED", "reason": "ValueError"})
    conn.close()


def box_measurement(a, b, c, *, solids=1, valid=True):
    """Exact measurement dict of an a x b x c box (what geometry.measure_shapes returns)."""
    v = a * b * c
    moments = sorted([v * (b * b + c * c) / 12, v * (a * a + c * c) / 12, v * (a * a + b * b) / 12])
    part = {"index": 0, "valid": valid, "volume_mm3": v, "area_mm2": 2 * (a * b + b * c + a * c),
            "principal_moments_mm5": moments, "principal_box_mm": sorted([a, b, c]),
            "center_of_mass_mm": [0.0, 0.0, 0.0]}
    return {"solids": solids, "valid": valid, "invalid_solids": 0 if valid else 1, "volume_mm3": v,
            "area_mm2": part["area_mm2"], "principal_moments_mm5": moments, "principal_box_mm": sorted([a, b, c]),
            "center_of_mass_mm": [0.0, 0.0, 0.0], "parts": [part]}
