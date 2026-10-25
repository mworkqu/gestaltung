// What the solver needs to know about each form WITHOUT building a mesh:
//   * frame:   its size in the local frame (x, y centred, z from 0) and the shift the
//              kernel applies to its raw build so both agree;
//   * anchors: where its top / bottom / front / back / left / right touch points are
//              (surface-aware: the "front" of a round head is on the head, at its
//              widest height, not at the corner of its bounding box);
//   * section: the cross-section at a height, inset by a wall (fits electronics);
//   * scaling: grow it to fit electronics, match a stacked neighbour's outline;
//   * overhang: steepest overhang printed upright / upside down / on its side;
//   * volume:  a quick volume estimate (grams before the kernel runs).

import {
  latheOutline,
  nozzlePath,
  outlineExtent,
  outlineOverhangDeg,
  outlineRadiusAt,
  outlineTopAt,
  r3,
  tubeBodyPath,
  type Vec2,
  type Vec3,
} from "../shapes";
import type { FormPart, FormPartOf } from "./params";
import { ROUND_TEMPLATES } from "./params";
import { clampForm } from "./clamp";

export const ANCHORS = ["top", "bottom", "front", "back", "left", "right"] as const;
export type Anchor = (typeof ANCHORS)[number];

export const ANCHOR_NORMAL: Record<Anchor, Vec3> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

export type Frame = {
  /** Local bounding box size [x, y, z] (mm). */
  size: Vec3;
  /** Added to the raw build (kernel) to land in the local frame. */
  offset: Vec3;
};

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export function latheOutlineOf(f: FormPartOf<"lathe_profile">): Vec2[] {
  return latheOutline(f.points, f.round);
}

/**
 * The round enclosure templates (puck, dome_base, lantern, stake_pod) are lathed: their
 * profile, shared by the kernel (mesh) and the solver (fit, anchors). null = not round.
 */
export function templateProfile(f: FormPartOf<"enclosure">): { points: [number, number][]; round: number } | null {
  const R = f.w / 2;
  const h = f.h;
  const soft = Math.min(2 * f.fillet, h / 2 - 0.5, R / 2);
  switch (f.template) {
    case "puck":
      return { points: [[R, 0], [R, h]], round: Math.max(1, soft) };
    case "dome_base": {
      const z0 = 0.55 * h;
      const rise = h - z0;
      const arc: [number, number][] = [30, 55, 75].map((deg) => [R * Math.cos((deg * Math.PI) / 180), z0 + rise * Math.sin((deg * Math.PI) / 180)]);
      return { points: [[R, 0], [R, z0], ...arc, [0, h]], round: Math.max(1, Math.min(f.fillet, 3)) };
    }
    case "lantern":
      return { points: [[0.85 * R, 0], [R, 0.12 * h], [R, 0.88 * h], [0.85 * R, h]], round: Math.max(1, soft) };
    case "stake_pod":
      return { points: [[0.7 * R, 0], [R, 0.3 * h], [R, 0.7 * h], [0.75 * R, h]], round: Math.max(1, soft) };
    default:
      return null;
  }
}

/** The (r, z) outline of any lathed form (lathe_profile or a round enclosure template). */
export function lathedOutline(f: FormPart): Vec2[] | null {
  if (f.kind === "lathe_profile") return latheOutlineOf(f);
  if (f.kind === "enclosure") {
    const p = templateProfile(f);
    return p ? latheOutline(p.points, p.round) : null;
  }
  return null;
}

function frameOfRaw(min: Vec3, max: Vec3): Frame {
  return {
    size: [r3(max[0] - min[0]), r3(max[1] - min[1]), r3(max[2] - min[2])],
    offset: [r3(-(min[0] + max[0]) / 2), r3(-(min[1] + max[1]) / 2), r3(-min[2])],
  };
}

function pathFrame(path: Vec3[], radius: number): Frame {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of path) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k] - radius);
      max[k] = Math.max(max[k], p[k] + radius);
    }
  }
  return frameOfRaw(min, max);
}

const NO_OFFSET: Vec3 = [0, 0, 0];

/** Thickness of a nozzle's flat base flange (mm). */
export const NOZZLE_FLANGE = 2;

/** The form's local size and the raw → local shift. */
export function formFrame(f: FormPart): Frame {
  switch (f.kind) {
    case "lathe_profile": {
      const { rMax, zMax } = outlineExtent(latheOutlineOf(f));
      return { size: [r3(2 * rMax), r3(2 * rMax), r3(zMax)], offset: NO_OFFSET };
    }
    case "rounded_extrude":
      return { size: [f.w, f.d, f.h], offset: NO_OFFSET };
    case "loft_rounded": {
      const y0 = Math.min(-f.d0 / 2, -f.d1 / 2 + f.shiftY);
      const y1 = Math.max(f.d0 / 2, f.d1 / 2 + f.shiftY);
      return frameOfRaw([-Math.max(f.w0, f.w1) / 2, y0, 0], [Math.max(f.w0, f.w1) / 2, y1, f.h]);
    }
    case "stake":
      return {
        size: f.section === "round" ? [f.width, f.width, f.length] : f.section === "blade" ? [f.width, f.thick, f.length] : [f.width, f.width, f.length],
        offset: NO_OFFSET,
      };
    case "prongs":
      return { size: [f.spacing + f.d, f.d, f.length], offset: NO_OFFSET };
    case "tube_sweep":
      return pathFrame(tubeBodyPath(f.length, f.bend), f.d / 2);
    case "nozzle": {
      // The path (spheres of radius d/2) plus a flat base flange (radius 1.4·d/2,
      // NOZZLE_FLANGE thick, behind the path start at raw y ∈ [0, NOZZLE_FLANGE]).
      const r = f.d / 2;
      const fr = 1.4 * r;
      const path = nozzlePath(f.length, f.angle, f.drop);
      const min: Vec3 = [-fr, Math.min(...path.map((p) => p[1])) - r, Math.min(-fr, ...path.map((p) => p[2] - r))];
      const max: Vec3 = [fr, NOZZLE_FLANGE, Math.max(fr, ...path.map((p) => p[2] + r))];
      return frameOfRaw(min, max);
    }
    case "ring": {
      return { size: [f.w + 2 * f.t, f.shape === "round" ? f.w + 2 * f.t : f.d + 2 * f.t, f.h], offset: NO_OFFSET };
    }
    case "tank":
      return { size: [f.w, f.shape === "round" ? f.w : f.d, f.h], offset: NO_OFFSET };
    case "button_cap":
      return { size: [f.d, f.d, r3(f.h + f.stem + f.seat)], offset: NO_OFFSET };
    case "knob":
      return { size: [f.d, f.d, f.h], offset: NO_OFFSET };
    case "grille_disc":
      return { size: [f.d, f.d, f.t], offset: NO_OFFSET };
    case "foot":
      return { size: [f.d, f.d, f.h], offset: NO_OFFSET };
    case "clip_arm":
      return { size: [f.w, f.length, r3(2 * f.t + f.gap)], offset: NO_OFFSET };
    case "hook":
      return { size: [f.w, f.reach + f.t, f.h], offset: NO_OFFSET };
    case "hinge_lid":
      return { size: [f.w, f.d, r3(2 * f.t)], offset: NO_OFFSET };
    case "enclosure": {
      const round = (ROUND_TEMPLATES as readonly string[]).includes(f.template);
      return { size: [f.w, round ? f.w : f.d, f.h], offset: NO_OFFSET };
    }
  }
}

export function isRoundForm(f: FormPart): boolean {
  switch (f.kind) {
    case "lathe_profile":
    case "button_cap":
    case "knob":
    case "grille_disc":
    case "foot":
      return true;
    case "ring":
    case "tank":
      return f.shape === "round";
    case "enclosure":
      return (ROUND_TEMPLATES as readonly string[]).includes(f.template);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export type AnchorPoint = { p: Vec3; n: Vec3 };

/** Height of a side anchor (where a neighbour attaches on a side face). */
function sideZ(f: FormPart, h: number): number {
  switch (f.kind) {
    case "lathe_profile":
      return outlineExtent(latheOutlineOf(f)).zAtRMax;
    case "enclosure": {
      if (f.template === "soft_wedge") return r3(0.3 * h);
      const o = lathedOutline(f);
      return o ? outlineExtent(o).zAtRMax : r3(h / 2);
    }
    default:
      return r3(h / 2);
  }
}

/**
 * The touch point of an anchor in the local frame, plus its outward normal. `du`, `dv`
 * slide along the face (side faces: du along the face's horizontal axis, dv up; top /
 * bottom: du = x, dv = y); on round forms the point stays on the curved surface.
 */
export function anchorPoint(f: FormPart, anchor: Anchor, du = 0, dv = 0): AnchorPoint {
  const { size, offset } = formFrame(f);
  const [w, d, h] = size;
  const n = ANCHOR_NORMAL[anchor];
  // Special touch points first.
  // A nozzle's base: the raw origin (shifted by `offset`), on its +y face.
  if (f.kind === "nozzle" && anchor === "back") return { p: [0, r3(d / 2), r3(offset[2])], n };
  if (f.kind === "button_cap" && anchor === "bottom") return { p: [du, dv, f.stem], n };
  if (anchor === "top" || anchor === "bottom") {
    if (anchor === "bottom") return { p: [du, dv, 0], n };
    return { p: [du, dv, r3(topAt(f, du, dv))], n };
  }
  const z = r3(sideZ(f, h) + dv);
  const axis = anchor === "front" || anchor === "back" ? 1 : 0;
  const sign = anchor === "front" || anchor === "left" ? -1 : 1;
  const half = axis === 1 ? d / 2 : w / 2;
  if (isRoundForm(f)) {
    const R = radiusAt(f, Math.min(h, Math.max(0, z)));
    const along = Math.max(-0.95 * R, Math.min(0.95 * R, du));
    const out = Math.sqrt(Math.max(0, R * R - along * along));
    const p: Vec3 = axis === 1 ? [along, sign * out, z] : [sign * out, along, z];
    return { p: [r3(p[0]), r3(p[1]), r3(p[2])], n };
  }
  if (f.kind === "loft_rounded") {
    const t = Math.min(1, Math.max(0, z / f.h));
    const yOff = f.shiftY * t + offset[1];
    if (axis === 1) {
      const dd = (f.d0 + (f.d1 - f.d0) * t) / 2;
      return { p: [r3(du), r3(yOff + sign * dd), z], n };
    }
    const ww = (f.w0 + (f.w1 - f.w0) * t) / 2;
    return { p: [r3(sign * ww), r3(du + yOff), z], n };
  }
  const p: Vec3 = axis === 1 ? [r3(du), r3(sign * half), z] : [r3(sign * half), r3(du), z];
  return { p, n };
}

/** Radius of a round form at height z (local frame). */
export function radiusAt(f: FormPart, z: number): number {
  switch (f.kind) {
    case "lathe_profile":
    case "enclosure": {
      const o = lathedOutline(f);
      return o ? outlineRadiusAt(o, z) : formFrame(f).size[0] / 2;
    }
    default:
      return formFrame(f).size[0] / 2;
  }
}

/** Top surface height at local (x, y). */
export function topAt(f: FormPart, x: number, y: number): number {
  const h = formFrame(f).size[2];
  switch (f.kind) {
    case "lathe_profile":
      return outlineTopAt(latheOutlineOf(f), Math.hypot(x, y));
    case "enclosure": {
      const o = lathedOutline(f);
      if (o) return outlineTopAt(o, Math.hypot(x, y));
      if (f.template === "soft_wedge") return wedgeTopAt(h, f.d, y);
      return h;
    }
    case "button_cap":
      return f.stem + f.seat + f.h;
    default:
      return h;
  }
}

// ---------------------------------------------------------------------------
// Sections (electronics fit)
// ---------------------------------------------------------------------------

/** Cross-section at height z inset by `inset` mm: a circle, or a rounded box. null = nothing. */
export type Section = { kind: "round"; r: number } | { kind: "box"; hw: number; hd: number; rc: number };

/** soft_wedge: the top falls from h at the back to WEDGE_FRONT·h at the front. */
export const WEDGE_FRONT = 0.6;
export function wedgeTopAt(h: number, d: number, y: number): number {
  return h * (WEDGE_FRONT + (1 - WEDGE_FRONT) * Math.min(1, Math.max(0, (y + d / 2) / d)));
}

export function sectionAt(f: FormPart, z: number, inset: number): Section | null {
  const h = formFrame(f).size[2];
  if (z < -1e-9 || z > h + 1e-9) return null;
  const roundSec = (r: number): Section | null => (r - inset > 0.5 ? { kind: "round", r: r - inset } : null);
  const boxSec = (hw: number, hd: number, rc: number): Section | null =>
    hw - inset > 0.5 && hd - inset > 0.5 ? { kind: "box", hw: hw - inset, hd: hd - inset, rc: Math.max(0, rc - inset) } : null;
  switch (f.kind) {
    case "lathe_profile":
      return roundSec(outlineRadiusAt(latheOutlineOf(f), z));
    case "rounded_extrude": {
      let shrink = 0;
      if (z > h - f.fillet) {
        const dz = z - (h - f.fillet);
        shrink = f.fillet - Math.sqrt(Math.max(0, f.fillet * f.fillet - dz * dz));
      }
      const rc = f.shape === "superellipse" ? Math.min(f.w, f.d) * 0.25 : f.r;
      return boxSec(f.w / 2 - shrink, f.d / 2 - shrink, rc);
    }
    case "loft_rounded": {
      const t = z / f.h;
      const ww = f.w0 + (f.w1 - f.w0) * t;
      const dd = f.d0 + (f.d1 - f.d0) * t;
      // The shifted top makes the shared (usable) depth smaller.
      const usableD = dd - Math.abs(f.shiftY) * t;
      return f.shape === "ellipse" ? roundSec(Math.min(ww, usableD) / 2) : boxSec(ww / 2, usableD / 2, f.r);
    }
    case "tank":
      return f.shape === "round" ? roundSec(f.w / 2) : boxSec(f.w / 2, f.d / 2, f.r);
    case "enclosure": {
      if ((ROUND_TEMPLATES as readonly string[]).includes(f.template)) return roundSec(radiusAt(f, z));
      if (f.template === "pill") return boxSec(f.w / 2, f.d / 2, Math.min(f.w, f.d) / 2);
      if (f.template === "handheld_taper") return boxSec(0.85 * f.w / 2, 0.85 * f.d / 2, f.r);
      // Keep electronics under the low front edge of a wedge.
      if (f.template === "soft_wedge" && z > WEDGE_FRONT * h - inset) return null;
      return boxSec(f.w / 2, f.d / 2, f.r);
    }
    default:
      return null;
  }
}

/** Is the point (x, y) inside the section? */
export function insideSection(sec: Section | null, x: number, y: number): boolean {
  if (!sec) return false;
  if (sec.kind === "round") return Math.hypot(x, y) <= sec.r + 1e-6;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > sec.hw + 1e-6 || ay > sec.hd + 1e-6) return false;
  const cx = sec.hw - sec.rc;
  const cy = sec.hd - sec.rc;
  if (ax <= cx || ay <= cy) return true;
  return Math.hypot(ax - cx, ay - cy) <= sec.rc + 1e-6;
}

/** Does a w × d box (centred) fit in the section? */
export function boxFits(sec: Section | null, w: number, d: number): boolean {
  if (!sec) return false;
  if (sec.kind === "round") return Math.hypot(w / 2, d / 2) <= sec.r + 1e-6;
  if (w / 2 > sec.hw + 1e-6 || d / 2 > sec.hd + 1e-6) return false;
  const cx = sec.hw - sec.rc;
  const cy = sec.hd - sec.rc;
  if (w / 2 <= cx || d / 2 <= cy) return true;
  return Math.hypot(w / 2 - cx, d / 2 - cy) <= sec.rc + 1e-6;
}

/**
 * Where a w × d × h box fits inside the form (inset by the wall), searching the height:
 * the lowest z0 ≥ floor with the box fitting at every sampled height up to z0 + h.
 * `topLimit` = the highest usable z (h − wall for a closed shell, h for an open top).
 */
export function fitHeight(f: FormPart, w: number, d: number, h: number, wall: number, topLimit: number): number | null {
  const steps = 48;
  const floor = wall;
  const H = topLimit;
  if (floor + h > H + 1e-6) return null;
  for (let s = 0; s <= steps; s++) {
    const z0 = floor + ((H - h - floor) * s) / steps;
    let ok = true;
    for (let k = 0; k <= 8; k++) {
      const z = z0 + (h * k) / 8;
      if (!boxFits(sectionAt(f, Math.min(z, H), wall), w, d)) {
        ok = false;
        break;
      }
    }
    if (ok) return r3(z0);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scaling (grow to fit; match a stacked neighbour)
// ---------------------------------------------------------------------------

/** The form scaled in plan (sx along x, sy along y) and height (sz), clamped again. */
export function scaleForm(f: FormPart, sx: number, sy: number, sz: number): FormPart {
  const s = Math.max(sx, sy);
  const g = structuredClone(f) as FormPart;
  switch (g.kind) {
    case "lathe_profile":
      g.points = g.points.map(([r, z]) => [r3(r * s), r3(z * sz)]);
      break;
    case "rounded_extrude":
      g.w = r3(g.w * sx);
      g.d = r3(g.d * sy);
      g.h = r3(g.h * sz);
      break;
    case "loft_rounded":
      g.w0 = r3(g.w0 * sx);
      g.w1 = r3(g.w1 * sx);
      g.d0 = r3(g.d0 * sy);
      g.d1 = r3(g.d1 * sy);
      g.shiftY = r3(g.shiftY * sy);
      g.h = r3(g.h * sz);
      break;
    case "tank":
      g.w = r3(g.w * (g.shape === "round" ? s : sx));
      g.d = r3(g.d * (g.shape === "round" ? s : sy));
      g.h = r3(g.h * sz);
      break;
    case "enclosure": {
      const round = (ROUND_TEMPLATES as readonly string[]).includes(g.template);
      g.w = r3(g.w * (round ? s : sx));
      g.d = r3(g.d * (round ? s : sy));
      g.h = r3(g.h * sz);
      break;
    }
    case "ring":
      g.w = r3(g.w * (g.shape === "round" ? s : sx));
      g.d = r3(g.d * (g.shape === "round" ? s : sy));
      g.h = r3(g.h * sz);
      break;
    case "stake":
      g.width = r3(g.width * s);
      g.length = r3(g.length * sz);
      break;
    default:
      break;
  }
  return clampForm(g, [], "form");
}

export type Outline = { shape: "round" | "rrect"; w: number; d: number; r: number };

/** The outline a stacked neighbour sees at this form's top or bottom (null = not stackable). */
export function stackOutline(f: FormPart, which: "top" | "bottom"): Outline | null {
  switch (f.kind) {
    case "lathe_profile": {
      const p = which === "top" ? f.points[f.points.length - 1] : f.points[0];
      return p[0] >= 4 ? { shape: "round", w: r3(2 * p[0]), d: r3(2 * p[0]), r: p[0] } : null;
    }
    case "rounded_extrude":
      return { shape: "rrect", w: f.w, d: f.d, r: f.shape === "superellipse" ? Math.min(f.w, f.d) * 0.3 : f.r };
    case "loft_rounded":
      return which === "top" ? { shape: f.shape === "ellipse" ? "round" : "rrect", w: f.w1, d: f.d1, r: f.r } : { shape: f.shape === "ellipse" ? "round" : "rrect", w: f.w0, d: f.d0, r: f.r };
    case "ring":
      return f.shape === "round"
        ? { shape: "round", w: r3(f.w + 2 * f.t), d: r3(f.w + 2 * f.t), r: r3(f.w / 2 + f.t) }
        : { shape: "rrect", w: r3(f.w + 2 * f.t), d: r3(f.d + 2 * f.t), r: r3(f.r + f.t) };
    case "tank":
      return f.shape === "round" ? { shape: "round", w: f.w, d: f.w, r: f.w / 2 } : { shape: "rrect", w: f.w, d: f.d, r: f.r };
    case "enclosure": {
      if ((ROUND_TEMPLATES as readonly string[]).includes(f.template)) {
        if (which === "top" && f.template === "dome_base") return null;
        return { shape: "round", w: f.w, d: f.w, r: f.w / 2 };
      }
      if (f.template === "soft_wedge" && which === "top") return null;
      return { shape: "rrect", w: f.w, d: f.d, r: f.template === "pill" ? Math.min(f.w, f.d) / 2 : f.r };
    }
    default:
      return null;
  }
}

/** The form resized so its `which` outline matches `o` (a stacked neighbour's). */
export function matchOutline(f: FormPart, which: "top" | "bottom", o: Outline): FormPart {
  const g = structuredClone(f) as FormPart;
  switch (g.kind) {
    case "lathe_profile": {
      const p = which === "top" ? g.points[g.points.length - 1] : g.points[0];
      if (p[0] <= 0) return f;
      const s = o.w / 2 / p[0];
      g.points = g.points.map(([r, z]) => [r3(r * s), z]);
      break;
    }
    case "rounded_extrude":
      g.w = o.w;
      g.d = o.d;
      g.r = Math.max(0.5, o.r);
      if (o.shape === "round") g.r = Math.min(o.w, o.d) / 2 - 0.01;
      break;
    case "loft_rounded":
      if (which === "top") {
        g.w1 = o.w;
        g.d1 = o.d;
      } else {
        g.w0 = o.w;
        g.d0 = o.d;
      }
      break;
    case "ring":
      g.shape = o.shape;
      g.w = r3(Math.max(10, o.w - 2 * g.t));
      g.d = r3(Math.max(10, o.d - 2 * g.t));
      g.r = r3(Math.max(0.5, o.r - g.t));
      break;
    case "tank":
      g.shape = o.shape;
      g.w = o.w;
      g.d = o.d;
      g.r = Math.max(2, o.r);
      break;
    case "enclosure":
      g.w = o.w;
      g.d = o.d;
      break;
    default:
      return f;
  }
  return clampForm(g, [], "form");
}

// ---------------------------------------------------------------------------
// Printing: overhang per orientation, volume estimate
// ---------------------------------------------------------------------------

export type PrintPose = "upright" | "flipped" | "on_side";

/**
 * Steepest outside overhang (degrees from vertical) when printed in `pose`. Hollow parts
 * are built so their inside never overhangs more than the outside (cone ceilings on
 * lathed shells, flat-topped shells printed upside down), so the outside decides.
 */
export function overhangDeg(f: FormPart, pose: PrintPose, opts: { flatBottom?: boolean } = {}): number {
  const flip = pose === "flipped";
  switch (f.kind) {
    case "lathe_profile":
      return pose === "on_side" ? 90 : outlineOverhangDeg(latheOutlineOf(f), flip);
    case "rounded_extrude":
      // Soft top fillet: fine upright (faces up). Upside down it is a rounded edge on the bed:
      // only its first mm overhangs and the slicer bridges it, so call it 45°. The bottom is
      // a 45° chamfer (or flat when a neighbour stacks under it).
      if (pose === "on_side") return 90;
      return flip ? 45 : opts.flatBottom ? 0 : 45;
    case "loft_rounded": {
      if (pose === "on_side") return 90;
      const lean = Math.max(Math.abs((f.w1 - f.w0) / 2), Math.abs((f.d1 - f.d0) / 2) + Math.abs(f.shiftY));
      const deg = (Math.atan2(lean, f.h) * 180) / Math.PI;
      const grows = f.w1 > f.w0 || f.d1 > f.d0 || Math.abs(f.shiftY) > 0;
      return flip ? (grows ? 0 : deg) : grows ? deg : Math.min(deg, 45);
    }
    case "stake":
      // Printed on its flat top (upside down): it only narrows going up.
      return flip ? 0 : 90;
    case "nozzle":
      return pose === "on_side" ? Math.min(45, f.angle) : 90;
    case "tube_sweep":
      return pose === "on_side" ? 45 : 90;
    case "ring":
    case "tank":
    case "knob":
    case "grille_disc":
    case "hinge_lid":
      return pose === "on_side" ? 90 : 0;
    case "button_cap":
      return flip ? 0 : f.stem > 0 ? 90 : 0;
    case "foot":
      return flip ? 90 : 0;
    case "clip_arm":
    case "hook":
      return pose === "on_side" ? 0 : 90;
    case "prongs":
      return 0;
    case "enclosure":
      if (pose === "on_side") return 90;
      if (f.template === "dome_base") return flip ? 90 : 0;
      return 45;
  }
}

/** Rough outside volume (mm³) of the solid form. */
export function solidVolume(f: FormPart): number {
  const [w, d, h] = formFrame(f).size;
  switch (f.kind) {
    case "lathe_profile": {
      const o = latheOutlineOf(f);
      let v = 0;
      // Pappus over the outline polygon: V = 2π · Σ (signed area × centroid r).
      for (let i = 0; i < o.length; i++) {
        const [r0, z0] = o[i];
        const [r1, z1] = o[(i + 1) % o.length];
        const cross = r0 * z1 - r1 * z0;
        v += cross * (r0 + r1);
      }
      return Math.abs((Math.PI * v) / 3);
    }
    case "stake":
      return w * (f.section === "blade" ? f.thick : f.section === "cross" ? 2 * f.thick : w) * h * (0.5 + 0.5 * f.taper);
    case "prongs":
      return 2 * Math.PI * (f.d / 2) ** 2 * f.length;
    case "tube_sweep":
      return Math.PI * (f.d / 2) ** 2 * f.length;
    case "nozzle":
      return Math.PI * ((f.d / 2) ** 2 - (f.bore / 2) ** 2) * (f.length + f.drop);
    case "ring": {
      const outer = f.shape === "round" ? Math.PI * ((f.w / 2 + f.t) ** 2 - (f.w / 2) ** 2) : (f.w + 2 * f.t) * (f.d + 2 * f.t) - f.w * f.d;
      return outer * f.h;
    }
    case "clip_arm":
      return f.w * f.length * 2 * f.t;
    case "hook":
      return f.w * f.t * (f.h + f.reach);
    case "hinge_lid":
      return f.w * f.d * f.t;
    default: {
      const roundish = isRoundForm(f);
      return w * d * h * (roundish ? Math.PI / 4 : 0.9);
    }
  }
}
