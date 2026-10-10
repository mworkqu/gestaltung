"""Small, safe helpers model code may import (`import cadhelpers`).

Imports only cadquery and math, so nothing here reaches the OS. Every size is
in millimetres.
"""

import math

import cadquery as cq

__all__ = ["open_box", "rounded_plate", "standoffs", "clearance", "math"]


def clearance(size_mm: float, per_side_mm: float = 0.5) -> float:
    """An inner size with clearance on both sides (0.5 mm per side by default)."""
    return size_mm + 2 * per_side_mm


def open_box(length: float, width: float, height: float, wall: float, floor: float | None = None) -> cq.Workplane:
    """An open-top box resting on z = 0: outer size length x width x height."""
    floor = wall if floor is None else floor
    outer = cq.Workplane("XY").box(length, width, height, centered=(True, True, False))
    cavity = (
        cq.Workplane("XY")
        .workplane(offset=floor)
        .box(length - 2 * wall, width - 2 * wall, height, centered=(True, True, False))
    )
    return outer.cut(cavity)


def rounded_plate(length: float, width: float, thickness: float, radius: float = 2.0) -> cq.Workplane:
    """A flat plate with rounded vertical edges, resting on z = 0."""
    plate = cq.Workplane("XY").box(length, width, thickness, centered=(True, True, False))
    if radius > 0:
        plate = plate.edges("|Z").fillet(min(radius, length / 2 - 0.01, width / 2 - 0.01))
    return plate


def standoffs(
    points: list[tuple[float, float]],
    height: float,
    outer_d: float = 6.0,
    hole_d: float = 2.7,
    z0: float = 0.0,
) -> cq.Workplane:
    """Round standoffs with a screw hole, standing on z = z0 (M2.5 hole by default)."""
    posts = (
        cq.Workplane("XY")
        .workplane(offset=z0)
        .pushPoints(points)
        .circle(outer_d / 2)
        .circle(hole_d / 2)
        .extrude(height)
    )
    return posts
