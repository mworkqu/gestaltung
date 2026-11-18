"""CadQuery / OpenCascade measurements. Runs ONLY inside the parse child process.

Imported by the forkserver preload on Linux, so cadquery is loaded once and
every child starts with it ready.
"""

from __future__ import annotations

import cadquery as cq
import numpy as np
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepGProp import BRepGProp
from OCP.gp import gp_Trsf
from OCP.GProp import GProp_GProps


def _props(occ_shape) -> GProp_GProps:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(occ_shape, props)
    return props


def _inertia_matrix(props: GProp_GProps) -> np.ndarray:
    mat = props.MatrixOfInertia()  # about the centre of mass, unit density (mm^5)
    return np.array([[mat.Value(i, j) for j in (1, 2, 3)] for i in (1, 2, 3)], dtype=float)


def _principal_moments(props: GProp_GProps, matrix: np.ndarray) -> list[float]:
    """Principal moments via PrincipalProperties(); eigenvalues as a fallback."""
    try:
        pp = props.PrincipalProperties()
        vals = pp.Moments()  # OCP returns the three out-params as a tuple
        if isinstance(vals, tuple) and len(vals) == 3:
            return sorted(float(v) for v in vals)
    except Exception:  # noqa: BLE001 — binding differences between OCP builds
        pass
    return sorted(float(v) for v in np.linalg.eigvalsh(matrix))


def _principal_box(shape: cq.Shape, com, matrix: np.ndarray) -> list[float]:
    """Bounding box along the principal axes (sorted ascending, mm)."""
    _, vecs = np.linalg.eigh(matrix)
    if np.linalg.det(vecs) < 0:
        vecs[:, 2] = -vecs[:, 2]
    rot = vecs.T  # rows = principal axes
    c = np.array([com.X(), com.Y(), com.Z()])
    t = -rot @ c
    values = [float(v) for i in range(3) for v in (rot[i, 0], rot[i, 1], rot[i, 2], t[i])]
    try:
        trsf = gp_Trsf()
        trsf.SetValues(*values)
        moved = cq.Shape.cast(BRepBuilderAPI_Transform(shape.wrapped, trsf, True).Shape())
        bb = moved.BoundingBox()
        return sorted([float(bb.xlen), float(bb.ylen), float(bb.zlen)])
    except Exception:  # noqa: BLE001 — box is informative only, never scored
        bb = shape.BoundingBox()
        return sorted([float(bb.xlen), float(bb.ylen), float(bb.zlen)])


def _measure_one(shape: cq.Shape) -> dict:
    props = _props(shape.wrapped)
    matrix = _inertia_matrix(props)
    com = props.CentreOfMass()
    return {
        "volume_mm3": float(props.Mass()),
        "area_mm2": float(shape.Area()),
        "principal_moments_mm5": _principal_moments(props, matrix),
        "principal_box_mm": _principal_box(shape, com, matrix),
        "center_of_mass_mm": [float(com.X()), float(com.Y()), float(com.Z())],
    }


def measure_shapes(shapes: list) -> dict:
    """Measure everything the grader needs from the imported shapes."""
    solids: list[cq.Solid] = []
    for s in shapes:
        if hasattr(s, "Solids"):
            solids.extend(s.Solids())
    if not solids:
        return {"solids": 0, "valid": False, "invalid_solids": 0, "volume_mm3": 0.0, "area_mm2": 0.0,
                "principal_moments_mm5": [0.0, 0.0, 0.0], "principal_box_mm": [0.0, 0.0, 0.0], "parts": []}
    parts = []
    invalid = 0
    for i, s in enumerate(solids):
        valid = bool(s.isValid())
        invalid += 0 if valid else 1
        parts.append({"index": i, "valid": valid, **_measure_one(s)})
    whole = cq.Compound.makeCompound(solids) if len(solids) > 1 else solids[0]
    out = _measure_one(whole)
    out.update({"solids": len(solids), "valid": invalid == 0, "invalid_solids": invalid, "parts": parts})
    return out


def import_and_measure(path: str) -> dict:
    wp = cq.importers.importStep(path)
    return measure_shapes(wp.vals())
