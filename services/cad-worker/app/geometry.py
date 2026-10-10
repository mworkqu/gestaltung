"""Geometry checks and exports. Imported only inside the child process.

Every check returns {"name", "pass", "detail"} with a plain-English detail.
Numbers are millimetres. Methods (documented in README.md):

- valid_solid: shape.isValid(), at least one solid, every shell of every
  solid closed (BRep_Tool.IsClosed), and no loose faces outside the solids.
- positive_volume: total volume > 0.
- must_contain_box: ray casting finds the inner floor and the cavity width on
  the centre lines, the board box is centred in that cavity, and an exact
  boolean (board box ∩ model) must have ~zero volume. Both flat orientations
  (board turned 0° and 90° about Z) are tried, at the model's centre and at
  each separate piece's centre. Material touching only the lower half of the
  box (standoffs, bosses) lifts the board onto it.
- min_wall: sample points spread over every face (by area), cast a ray from
  each point along the inward normal and measure how far it travels through
  material before leaving it. The reported wall is the smallest such
  thickness. It is an approximation: very small features between samples can
  be missed, and a ray that leaves through an edge can read a little thin.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cadquery as cq
import OCP.TopAbs as ta
from OCP.BRep import BRep_Tool
from OCP.BRepGProp import BRepGProp_Face
from OCP.BRepIntCurveSurface import BRepIntCurveSurface_Inter
from OCP.BRepTopAdaptor import BRepTopAdaptor_FClass2d
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt, gp_Pnt2d, gp_Vec


class BuildError(Exception):
    """A plain-English problem with the model's result."""


# ---------------------------------------------------------------- formatting


def r1(v: float) -> float:
    return round(float(v), 1) + 0.0


def fmt(v: float) -> str:
    """70.0 -> '70', 70.25 -> '70.3'."""
    return f"{r1(v):g}"


def fmt_box(x: float, y: float, z: float) -> str:
    return f"{fmt(x)} × {fmt(y)} × {fmt(z)} mm"


def check(name: str, ok: bool, detail: str) -> dict:
    return {"name": name, "pass": bool(ok), "detail": detail}


# ------------------------------------------------------------- result → shape


def to_shape(result) -> cq.Shape:
    if result is None:
        raise BuildError("The code never set `result` to a shape.")
    if isinstance(result, cq.Assembly):
        try:
            shape = result.toCompound()
        except Exception as exc:  # noqa: BLE001
            raise BuildError(f"The assembly could not be combined into one model: {exc}") from None
        if not shape.Solids() and not shape.Faces():
            raise BuildError("The assembly is empty — add parts to it before assigning it to `result`.")
        return shape
    if isinstance(result, cq.Workplane):
        shapes = [v for v in result.vals() if isinstance(v, cq.Shape)]
        if not shapes:
            raise BuildError(
                "`result` is an empty Workplane — nothing was built. "
                "Finish with a solid (for example .box(), .extrude() or .revolve())."
            )
        return shapes[0] if len(shapes) == 1 else cq.Compound.makeCompound(shapes)
    if isinstance(result, cq.Shape):
        return result
    if isinstance(result, cq.Sketch):
        raise BuildError("`result` is a 2D Sketch. Extrude it into a solid before assigning it to `result`.")
    raise BuildError(
        f"`result` must be a CadQuery Workplane, Shape or Assembly, not {type(result).__name__}."
    )


# ---------------------------------------------------------------- basic checks


def check_valid_solid(shape: cq.Shape) -> tuple[dict, list]:
    solids = shape.Solids()
    if not solids:
        faces = len(shape.Faces())
        what = f"{faces} surface{'s' if faces != 1 else ''}" if faces else "only lines or points"
        return (
            check(
                "valid_solid",
                False,
                f"The model has no solid body — it is {what}, so it cannot be made. "
                "Build closed solids (box, extrude, revolve, loft) instead of loose faces or shells.",
            ),
            [],
        )
    open_count = 0
    for s in solids:
        shells = s.Shells()
        if not shells or not all(BRep_Tool.IsClosed_s(sh.wrapped) for sh in shells):
            open_count += 1
    loose_faces = len(shape.Faces()) - sum(len(s.Faces()) for s in solids)
    valid = shape.isValid()
    problems = []
    if open_count:
        problems.append(f"{open_count} of {len(solids)} bodies are not closed")
    if loose_faces > 0:
        problems.append(f"there are {loose_faces} loose surfaces outside the solid bodies")
    if not valid:
        problems.append("the geometry checker found broken faces or edges (often a failed fillet or boolean)")
    if problems:
        return check("valid_solid", False, "The model is not a clean solid: " + "; ".join(problems) + "."), solids
    if len(solids) == 1:
        return check("valid_solid", True, "One closed, valid solid."), solids
    return check("valid_solid", True, f"{len(solids)} closed, valid solid pieces."), solids


def check_volume(shape: cq.Shape) -> tuple[dict, float]:
    try:
        vol = float(shape.Volume())
    except Exception:  # noqa: BLE001
        vol = 0.0
    if vol > 1e-6:
        return check("positive_volume", True, f"Volume about {vol:,.0f} mm³ ({vol / 1000:.1f} cm³)."), vol
    return check("positive_volume", False, "The model has no volume, so there is nothing to make."), max(vol, 0.0)


def bbox_of(shape: cq.Shape):
    bb = shape.BoundingBox()
    return bb, {"x": r1(bb.xlen), "y": r1(bb.ylen), "z": r1(bb.zlen)}


# ------------------------------------------------------------------ ray tools


def _inside(solids, p) -> bool:
    v = cq.Vector(*p)
    for s in solids:
        try:
            if s.isInside(v, 1e-6):
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def material_intervals(shape: cq.Shape, solids, origin, direction, length: float):
    """Intervals [(t0, t1)] along origin + t·direction (0 <= t <= length) that are inside material."""
    d = cq.Vector(*direction).normalized()
    o = cq.Vector(*origin)
    hits: list[float] = []
    inter = BRepIntCurveSurface_Inter()
    inter.Init(shape.wrapped, gp_Lin(gp_Pnt(o.x, o.y, o.z), gp_Dir(d.x, d.y, d.z)), 1e-7)
    while inter.More():
        w = inter.W()
        if 1e-6 < w < length - 1e-6:
            hits.append(w)
        inter.Next()
    hits.sort()
    cuts = [0.0]
    for w in hits:
        if w - cuts[-1] > 1e-6:
            cuts.append(w)
    if length - cuts[-1] > 1e-6:
        cuts.append(length)
    intervals: list[list[float]] = []
    for a, b in zip(cuts, cuts[1:]):
        m = (a + b) / 2
        if _inside(solids, (o.x + d.x * m, o.y + d.y * m, o.z + d.z * m)):
            if intervals and abs(intervals[-1][1] - a) < 1e-6:
                intervals[-1][1] = b
            else:
                intervals.append([a, b])
    return [(a, b) for a, b in intervals]


# ------------------------------------------------------------ must_contain_box


@dataclass
class Cavity:
    cx: float
    cy: float
    floor: float
    top: float
    xl: float
    xr: float
    yl: float
    yr: float

    @property
    def width_x(self) -> float:
        return self.xr - self.xl

    @property
    def width_y(self) -> float:
        return self.yr - self.yl

    @property
    def height(self) -> float:
        return self.top - self.floor


def _free_span(shape, solids, fixed, axis: int, centre: float, lo: float, hi: float):
    """Empty span along one horizontal axis around `centre` at the fixed point. None if centre is in material."""
    origin = list(fixed)
    origin[axis] = lo
    direction = [0.0, 0.0, 0.0]
    direction[axis] = 1.0
    length = hi - lo
    t_c = centre - lo
    left, right = 0.0, length
    for a, b in material_intervals(shape, solids, origin, direction, length):
        if a <= t_c <= b:
            return None
        if b <= t_c:
            left = max(left, b)
        elif a >= t_c:
            right = min(right, a)
    return lo + left, lo + right


def _cavities(shape, solids, bb, cx: float, cy: float, need_h: float):
    """Empty vertical gaps above a floor on the line through (cx, cy), measured across."""
    pad = 1.0
    z0 = bb.zmin - pad
    length = bb.zlen + 2 * pad
    mats = material_intervals(shape, solids, (cx, cy, z0), (0, 0, 1), length)
    if not mats:
        return []
    gaps = []
    for (a1, b1), (a2, _b2) in zip(mats, mats[1:]):
        gaps.append((z0 + b1, z0 + a2))
    gaps.append((z0 + mats[-1][1], bb.zmax))  # open top: the cavity ends at the top of the model
    out = []
    for floor, top in gaps:
        if top - floor <= 1e-3:
            continue
        zm = floor + min(need_h, top - floor) / 2
        x0, y0 = cx, cy
        # Measure across, re-centre in the cavity, measure again.
        for _ in range(2):
            sx = _free_span(shape, solids, (x0, y0, zm), 0, x0, bb.xmin - pad, bb.xmax + pad)
            sy = _free_span(shape, solids, (x0, y0, zm), 1, y0, bb.ymin - pad, bb.ymax + pad)
            if sx is None or sy is None:
                break
            x0, y0 = (sx[0] + sx[1]) / 2, (sy[0] + sy[1]) / 2
        else:
            # Spans that reach past the model are not a cavity (the line left the part).
            if sx[0] <= bb.xmin - pad / 2 or sx[1] >= bb.xmax + pad / 2:
                continue
            if sy[0] <= bb.ymin - pad / 2 or sy[1] >= bb.ymax + pad / 2:
                continue
            out.append(Cavity(x0, y0, floor, top, sx[0], sx[1], sy[0], sy[1]))
    return out


def _box_fits(shape, cav: Cavity, lx: float, ly: float, lz: float):
    """Exact test: place the board box on the floor; lift it onto low bosses. Returns z or None."""
    eps = 0.01
    tol = 0.05  # mm³ of overlap treated as touching
    z = cav.floor + eps
    for _ in range(6):
        if z + lz > cav.top + 1e-6:
            return None
        box = cq.Solid.makeBox(lx, ly, lz, pnt=cq.Vector(cav.cx - lx / 2, cav.cy - ly / 2, z))
        common = shape.intersect(box)
        vol = float(common.Volume()) if common is not None else 0.0
        if vol <= tol:
            return z
        top = common.BoundingBox().zmax
        if top - z >= lz / 2:  # material reaches the upper half: a wall, not a standoff
            return None
        z = top + eps
    return None


def check_contains_box(shape: cq.Shape, solids, bb, box: dict) -> dict:
    bx, by, bz = float(box["x"]), float(box["y"]), float(box["z"])
    board = fmt_box(bx, by, bz)
    centres = [((bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2)]
    if len(solids) > 1:
        for s in sorted(solids, key=lambda s: s.Volume(), reverse=True)[:4]:
            sb = s.BoundingBox()
            centres.append(((sb.xmin + sb.xmax) / 2, (sb.ymin + sb.ymax) / 2))
    orientations = [(bx, by, False)] + ([(by, bx, True)] if abs(bx - by) > 1e-9 else [])

    best: Cavity | None = None
    seen: set[tuple] = set()
    for cx, cy in centres:
        for cav in _cavities(shape, solids, bb, cx, cy, bz):
            key = (round(cav.cx, 2), round(cav.cy, 2), round(cav.floor, 2))
            if key in seen:
                continue
            seen.add(key)
            if best is None or cav.width_x * cav.width_y * cav.height > best.width_x * best.width_y * best.height:
                best = cav
            for lx, ly, turned in orientations:
                if cav.width_x + 1e-6 < lx or cav.width_y + 1e-6 < ly or cav.height + 1e-6 < bz:
                    continue
                z = _box_fits(shape, cav, lx, ly, bz)
                if z is None:
                    continue
                sx = (cav.width_x - lx) / 2
                sy = (cav.width_y - ly) / 2
                above = cav.top - (z + bz)
                lifted = z - cav.floor > 0.1
                room = (
                    f"about {fmt(sx)} mm per side lengthwise, {fmt(sy)} mm per side widthwise "
                    f"and {fmt(above)} mm above it"
                )
                extras = []
                if turned:
                    extras.append("turned 90°")
                if lifted:
                    extras.append(f"resting {fmt(z - cav.floor)} mm above the floor on its supports")
                extra = f" ({', '.join(extras)})" if extras else ""
                if min(sx, sy) < 0.3:
                    return check("must_contain_box", True, f"Fits your board ({board}){extra}, but tightly: {room}.")
                return check("must_contain_box", True, f"Fits your board ({board}){extra} with room to spare: {room}.")

    if best is None:
        return check(
            "must_contain_box",
            False,
            f"We could not find an inner space for your board ({board}) — the model has no open cavity above a floor.",
        )
    return check(
        "must_contain_box",
        False,
        f"Your board ({board}) does not fit: the inner space is about "
        f"{fmt(best.width_x)} × {fmt(best.width_y)} mm with {fmt(best.height)} mm of height.",
    )


# ------------------------------------------------------------------- min_wall


def _face_samples(shape: cq.Shape, budget: int = 300, max_points: int = 700):
    faces = shape.Faces()
    areas = []
    for f in faces:
        try:
            areas.append(max(float(f.Area()), 0.0))
        except Exception:  # noqa: BLE001
            areas.append(0.0)
    total = sum(areas) or 1.0
    points = []
    for f, area in sorted(zip(faces, areas), key=lambda fa: -fa[1]):
        if len(points) >= max_points:
            break
        n = max(1, round(budget * area / total))
        k = max(1, math.ceil(math.sqrt(n)))
        try:
            umin, umax, vmin, vmax = f._uvBounds()
            classifier = BRepTopAdaptor_FClass2d(f.wrapped, 1e-6)
            props = BRepGProp_Face(f.wrapped)
        except Exception:  # noqa: BLE001
            continue
        for i in range(k):
            for j in range(k):
                u = umin + (i + 0.5) / k * (umax - umin)
                v = vmin + (j + 0.5) / k * (vmax - vmin)
                try:
                    if classifier.Perform(gp_Pnt2d(u, v)) != ta.TopAbs_IN:
                        continue
                    p, nv = gp_Pnt(), gp_Vec()
                    props.Normal(u, v, p, nv)
                    if nv.Magnitude() < 1e-9:
                        continue
                    nv.Normalize()
                except Exception:  # noqa: BLE001
                    continue
                points.append(((p.X(), p.Y(), p.Z()), (nv.X(), nv.Y(), nv.Z())))
    return points


def wall_thickness_at(shape, solids, p, n, cap: float):
    """Distance through material from p along the inward normal (-n); None if it cannot be read."""
    for sign in (-1.0, 1.0):  # -n is inward for a correctly oriented face; +n is the fallback
        d = (n[0] * sign, n[1] * sign, n[2] * sign)
        for a, b in material_intervals(shape, solids, p, d, cap):
            if a < 1e-3:
                return b - a
            break
    return None


def check_min_wall(shape: cq.Shape, solids, min_wall_mm: float) -> dict:
    cap = max(10.0, 4.0 * min_wall_mm)
    thinnest = None
    where = None
    readings = 0
    for p, n in _face_samples(shape):
        t = wall_thickness_at(shape, solids, p, n, cap)
        if t is None or t < 1e-3:
            continue
        readings += 1
        if thinnest is None or t < thinnest:
            thinnest, where = t, p
    if thinnest is None:
        return check("min_wall", False, "We could not measure the wall thickness of this model.")
    if thinnest >= cap - 1e-6:
        return check("min_wall", True, f"Walls at least {fmt(cap)} mm thick (minimum {fmt(min_wall_mm)} mm).")
    if thinnest + 0.05 >= min_wall_mm:
        return check("min_wall", True, f"Walls about {thinnest:.1f} mm (minimum {fmt(min_wall_mm)} mm).")
    x, y, z = where
    return check(
        "min_wall",
        False,
        f"The thinnest wall is about {thinnest:.1f} mm, below the {fmt(min_wall_mm)} mm minimum "
        f"(near x {fmt(x)}, y {fmt(y)}, z {fmt(z)} mm).",
    )


# -------------------------------------------------------------------- exports


SVG_OPTIONS = {
    "width": 600,
    "height": 600,
    "marginLeft": 20,
    "marginTop": 20,
    "showAxes": False,
    "projectionDir": (1.0, -1.0, 0.8),
    "strokeWidth": -1.0,
    "strokeColor": (110, 116, 128),
    "hiddenColor": (190, 196, 204),
    "showHidden": False,
}


def export_all(shape: cq.Shape, step_path: str, stl_path: str, svg_path: str) -> None:
    from cadquery import exporters

    exporters.export(shape, step_path, exporters.ExportTypes.STEP)
    exporters.export(shape, stl_path, exporters.ExportTypes.STL, tolerance=0.05, angularTolerance=0.2)
    exporters.export(shape, svg_path, exporters.ExportTypes.SVG, opt=SVG_OPTIONS)
