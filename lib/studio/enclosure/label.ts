// Raised label (EnclosureSpec.label): where it goes and its geometry.
//
// planLabel() is pure maths (tests + build.ts): it picks the surface (the lid top;
// the front (-y) face of a lantern's upper band), the biggest cap height from 8 down
// to 4 mm that fits, and the free spot nearest the preferred point that keeps ≥ 3 mm
// from every opening on that surface. labelGeometry() turns the plan into rounded
// capsules raised LABEL_RAISE mm above the surface (and dipping into it), which
// build.ts unions into the lid mesh — so the label is part of the lid's STL.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec3 } from "../layout";
import { cutoutBox, type Cutout } from "./cutouts";
import { labelSupport, layoutLabel, type LabelSkipReason, type Stroke } from "./label-font";
import { insideSection, topAt, type EnclosureDims } from "./templates";

/** Raised height of the letters above the surface (mm). */
export const LABEL_RAISE = 0.6;
/** Minimum lid material between the label and any opening (mm). */
export const LABEL_MARGIN = 3;
export const LABEL_CAP = { max: 8, min: 4, step: 0.5 } as const;

export type LabelSurface = "top" | "front";

export type LabelPlan = {
  text: string;
  surface: LabelSurface;
  /** Cap height (mm). */
  cap: number;
  /** Stroke radius (mm). */
  r: number;
  /** Centre on the surface: top → (x, y); front → (x, z). */
  center: [number, number];
  width: number;
  height: number;
  /** Strokes in label space (mm, centred, x = reading direction, y = up). */
  strokes: Stroke[];
  /** World AABB of the raised text (for vents / tests). */
  box: { min: Vec3; max: Vec3 };
};

export type LabelResult = { plan: LabelPlan | null; skipped?: LabelSkipReason | "space" };

type Rect = { u0: number; u1: number; v0: number; v1: number };

const rectsOverlap = (a: Rect, b: Rect, margin: number) =>
  a.u0 < b.u1 + margin && b.u0 < a.u1 + margin && a.v0 < b.v1 + margin && b.v0 < a.v1 + margin;

/** The surface a template's label goes on. */
export function labelSurfaceFor(d: EnclosureDims): LabelSurface {
  return d.template === "lantern" ? "front" : "top";
}

type Region = {
  bounds: Rect;
  inside: (u: number, v: number) => boolean;
  preferred: [number, number];
  obstacles: Rect[];
};

function regionFor(d: EnclosureDims, surface: LabelSurface, openings: Cutout[], h: number): Region {
  if (surface === "front") {
    // Flat part of the -y face, on the lid band (above the split), as low as possible.
    const hu = d.W / 2 - d.cornerRadius - 1.5;
    const v0 = d.splitZ + 2.5;
    const v1 = d.H - Math.max(d.edgeFillet, d.wall) - 1.5;
    const obstacles = openings
      .filter((c) => c.face === "-y")
      .map(cutoutBox)
      .map((b) => ({ u0: b.min[0], u1: b.max[0], v0: b.min[2], v1: b.max[2] }));
    return {
      bounds: { u0: -hu, u1: hu, v0, v1 },
      inside: (u, v) => Math.abs(u) <= hu + 1e-9 && v >= v0 - 1e-9 && v <= v1 + 1e-9,
      preferred: [0, v0 + h / 2],
      obstacles,
    };
  }
  const inset = Math.max(d.edgeFillet, d.wall) + 1.5;
  const R = d.W / 2;
  const obstacles = openings
    .filter((c) => c.face === "+z")
    .map(cutoutBox)
    .map((b) => ({ u0: b.min[0], u1: b.max[0], v0: b.min[1], v1: b.max[1] }));
  return {
    bounds: { u0: -d.W / 2, u1: d.W / 2, v0: -d.D / 2, v1: d.D / 2 },
    // On a dome keep to the gentle top (slope ≤ ~35°).
    inside: (u, v) => insideSection(d, u, v, inset) && (!d.dome || Math.hypot(u, v) <= 0.55 * R),
    preferred: [0, 0],
    obstacles,
  };
}

/** Where the label goes (or why it is skipped). `openings` = every cut-out on the case (ports, keyholes). */
export function planLabel(text: string | undefined, d: EnclosureDims, openings: Cutout[]): LabelResult {
  const sup = labelSupport(text);
  if (!sup.ok) return sup.reason === "empty" ? { plan: null } : { plan: null, skipped: sup.reason };
  const surface = labelSurfaceFor(d);
  for (let cap = LABEL_CAP.max; cap >= LABEL_CAP.min - 1e-9; cap -= LABEL_CAP.step) {
    const lay = layoutLabel(sup.text, cap);
    const region = regionFor(d, surface, openings, lay.height);
    const hw = lay.width / 2;
    const hh = lay.height / 2;
    const { bounds, preferred } = region;
    // Candidate centres on a 1 mm grid, nearest the preferred point first (deterministic).
    const cands: [number, number, number][] = [];
    for (let u = Math.ceil(bounds.u0 + hw); u <= bounds.u1 - hw + 1e-9; u += 1) {
      for (let v = Math.ceil(bounds.v0 + hh); v <= bounds.v1 - hh + 1e-9; v += 1) {
        cands.push([u, v, Math.hypot(u - preferred[0], v - preferred[1])]);
      }
    }
    cands.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    for (const [u, v] of cands) {
      const rect: Rect = { u0: u - hw, u1: u + hw, v0: v - hh, v1: v + hh };
      if (
        !region.inside(rect.u0, rect.v0) || !region.inside(rect.u1, rect.v0) ||
        !region.inside(rect.u0, rect.v1) || !region.inside(rect.u1, rect.v1)
      ) continue;
      if (region.obstacles.some((o) => rectsOverlap(rect, o, LABEL_MARGIN))) continue;
      const plan: LabelPlan = {
        text: sup.text,
        surface,
        cap: Math.round(cap * 100) / 100,
        r: lay.r,
        center: [u, v],
        width: lay.width,
        height: lay.height,
        strokes: lay.strokes,
        box: labelBox(d, surface, rect),
      };
      return { plan };
    }
  }
  return { plan: null, skipped: "space" };
}

function labelBox(d: EnclosureDims, surface: LabelSurface, r: Rect): { min: Vec3; max: Vec3 } {
  if (surface === "front") {
    const y = -d.D / 2;
    return { min: [r.u0, y - LABEL_RAISE, r.v0], max: [r.u1, y + 1, r.v1] };
  }
  const zs = [topAt(d, r.v0, r.u0), topAt(d, r.v0, r.u1), topAt(d, r.v1, r.u0), topAt(d, r.v1, r.u1), topAt(d, (r.v0 + r.v1) / 2, (r.u0 + r.u1) / 2)];
  return { min: [r.u0, r.v0, Math.min(...zs) - 1], max: [r.u1, r.v1, Math.max(...zs) + LABEL_RAISE] };
}

/** Surface point + outward normal for label-space (u, v). */
function surfacePoint(plan: LabelPlan, d: EnclosureDims, u: number, v: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const [cu, cv] = plan.center;
  if (plan.surface === "front") {
    return { p: new THREE.Vector3(cu + u, -d.D / 2, cv + v), n: new THREE.Vector3(0, -1, 0) };
  }
  const x = cu + u;
  const y = cv + v;
  const e = 0.05;
  const gx = (topAt(d, y, x + e) - topAt(d, y, x - e)) / (2 * e);
  const gy = (topAt(d, y + e, x) - topAt(d, y - e, x)) / (2 * e);
  return { p: new THREE.Vector3(x, y, topAt(d, y, x)), n: new THREE.Vector3(-gx, -gy, 1).normalize() };
}

/** Rounded capsules for every stroke (one merged geometry; the capsules never touch each other). */
export function labelGeometry(plan: LabelPlan, d: EnclosureDims): THREE.BufferGeometry {
  const parts = plan.strokes.map((s) => {
    const A = surfacePoint(plan, d, s.a[0], s.a[1]);
    const B = surfacePoint(plan, d, s.b[0], s.b[1]);
    const n = A.n.clone().add(B.n).normalize();
    const off = n.clone().multiplyScalar(LABEL_RAISE - plan.r);
    const a = A.p.clone().add(off);
    const b = B.p.clone().add(off);
    const axis = b.clone().sub(a);
    const length = axis.length();
    // Few segments: the strokes are under 1.5 mm wide, facets do not show.
    const g = new THREE.CapsuleGeometry(plan.r, Math.max(1e-3, length), 1, 6);
    g.deleteAttribute("uv");
    // Capsule axis = local y; it has a ring vertex on local +x → turn that vertex to the
    // surface normal so the top of every stroke is exactly LABEL_RAISE above the surface.
    const y = length > 1e-6 ? axis.normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
    if (y.lengthSq() < 0.5) y.set(0, 1, 0).cross(n).normalize();
    const x = n.clone().sub(y.clone().multiplyScalar(n.dot(y))).normalize();
    const z = x.clone().cross(y);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    return g;
  });
  return mergeGeometries(parts)!;
}
