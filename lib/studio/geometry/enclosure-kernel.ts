// The template enclosure, built by the product kernel.
//
// F-003 / FIX_REPORT §3.2: this replaces the three-bvh-csg builder, whose
// booleans were non-manifold at the source (the dome lid came back with 2,611
// unbalanced edges out of 6,275 triangles), so the Print step had no file to
// hand over after the customer had already spent a CAD credit. Everything here
// goes through manifold-3d via kernel-core.ts — the same primitives the product
// path uses — so a template case comes out of the worker watertight, one shell
// per body, consistently wound.
//
// The SHAPE is unchanged: every surface is built from the numbers in
// lib/studio/enclosure/templates.ts (EnclosureDims) and the openings from
// lib/studio/enclosure/cutouts.ts, exactly as the old builder read them:
//
//  * flat-footprint templates (rounded_box, pill, soft_wedge, handheld_taper,
//    lantern, wall_plate) are the convex hull of their own filleted profile
//    slices — the plan outline comes from outlineAt() (tapered by taperScale for
//    handheld_taper) and the heights from wedgeShift() for soft_wedge;
//  * round templates (puck, dome_base, stake_pod) are revolved (r, z) profiles:
//    the dome is a cylinder plus the half-ellipsoid cap, and its cavity follows
//    innerTopAt() so the dome shell stays ≥ wall thick;
//  * shell = outer (+ the raised label) − cavity − every cut-out;
//  * the shell is split at splitZ and the lid keeps the lip ring + flange;
//  * stake_pod: a "+" socket is cut up into the thick floor and the soil spike
//    is its own body (printed on its own, flat peg end down).
//
// Pure function of (manifold module, plan): no three.js, no DOM.

import type { Manifold, ManifoldToplevel } from "manifold-3d";
import {
  Arena,
  cs,
  frameMat,
  latheSolid,
  meshArrays,
  union,
  type K,
  type MeshArrays,
} from "./kernel-core";
import { checkPrintable, type PrintCheck } from "./mesh-check";
import type { Cutout } from "../enclosure/cutouts";
import { labelCapsules } from "../enclosure/label";
import type { EnclosurePlan } from "../enclosure/plan";
import {
  LIP,
  innerTopAt,
  outlineAt,
  taperScale,
  wedgeShift,
  type EnclosureDims,
} from "../enclosure/templates";
import { ellipseOutline, rrectOutline, type Vec2, type Vec3 } from "../product/shapes";

/** Radial segments of a revolved template (owner rule: never coarser than 64). */
const LATHE_SEGS = 96;
/** Points per 90° of a rounded corner in plan. */
const CORNER_STEPS = 10;
/** Steps along an edge fillet / the dome cap. */
const BEVEL_STEPS = 4;
const DOME_STEPS = 16;

export const SPIKE_ID = "enclosure_spike";

export type BuiltCase = {
  base: MeshArrays;
  lid: MeshArrays;
  /** stake_pod only: the soil spike, a printed part of its own. */
  spike: MeshArrays | null;
  checks: { base: PrintCheck; lid: PrintCheck; spike: PrintCheck | null };
  triangles: number;
  ms: number;
};

// ---------------------------------------------------------------------------
// Plan outlines (the cross-section of a template, inset by `inset` mm)
// ---------------------------------------------------------------------------

/**
 * The cross-section inset by `inset`. `tInset` is the inset the taper is measured
 * at (0 for the outer surface, the wall for the cavity) — the old builder deformed
 * a whole solid with one inset, and the cut-outs were placed against that.
 */
function planOutline(d: EnclosureDims, inset: number, tInset = inset): Vec2[] {
  const o = outlineAt(d, inset);
  if (o.hw <= 0.05 || o.hd <= 0.05) return [];
  if (d.shape === "circle") return ellipseOutline(2 * o.hw, 2 * o.hd, LATHE_SEGS);
  const pts = rrectOutline(2 * o.hw, 2 * o.hd, o.r, CORNER_STEPS);
  if (!d.taper) return pts;
  // handheld_taper narrows the OTHER axis as a function of the taper axis.
  return pts.map(([x, y]): Vec2 => (d.taper!.axis === "x" ? [x, y * taperScale(d, x, tInset)] : [x * taperScale(d, y, tInset), y]));
}

/** soft_wedge: the vertex shift the old builder applied (z' = z + Δ(y)·blend(z)). */
function wedgeZ(d: EnclosureDims, y: number, z: number): number {
  const ws = wedgeShift(d);
  if (!ws) return z;
  const t = Math.min(1, Math.max(0, (z - ws.zA) / (ws.zB - ws.zA)));
  return z + (y - d.D / 2) * ws.slope * t;
}

// ---------------------------------------------------------------------------
// Flat-footprint templates: convex hull of profile slices
// ---------------------------------------------------------------------------

type Slice = { inset: number; z: number };

function hullOf(k: K, d: EnclosureDims, slices: Slice[], tInset: number): Manifold | null {
  const pts: Vec3[] = [];
  for (const s of slices) {
    for (const [x, y] of planOutline(d, s.inset, tInset)) pts.push([x, y, wedgeZ(d, y, s.z)]);
  }
  if (pts.length < 4) return null;
  return k.a.t(k.mf.Manifold.hull(pts));
}

/** Slab profile z0..z1 with fillet `f` on the top and bottom edges (the old slabProfile). */
function slabSlices(z0: number, z1: number, f: number): Slice[] {
  if (f <= 0.01) return [{ inset: 0, z: z0 }, { inset: 0, z: z1 }];
  const out: Slice[] = [];
  for (let i = 0; i <= BEVEL_STEPS; i++) {
    const a = (i / BEVEL_STEPS) * (Math.PI / 2);
    out.push({ inset: f * (1 - Math.sin(a)), z: z0 + f * (1 - Math.cos(a)) });
  }
  for (let i = 0; i <= BEVEL_STEPS; i++) {
    const a = (i / BEVEL_STEPS) * (Math.PI / 2);
    out.push({ inset: f * (1 - Math.cos(a)), z: z1 - f + f * Math.sin(a) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Round templates: revolved (r, z) profiles
// ---------------------------------------------------------------------------

/** Closed half-profile (r, z) of a round template's outer surface, bottom → top. */
function latheProfile(d: EnclosureDims): Vec2[] {
  const R = d.W / 2;
  const f = d.edgeFillet;
  const out: Vec2[] = [[0, 0]];
  for (let i = 0; i <= BEVEL_STEPS; i++) {
    const a = (i / BEVEL_STEPS) * (Math.PI / 2);
    out.push([R - f * (1 - Math.sin(a)), f * (1 - Math.cos(a))]);
  }
  if (d.dome) {
    // Cylinder up to the shoulder, then the half-ellipsoid cap (r = R·cos t).
    const tMax = Math.acos(Math.min(0.999, 0.5 / R));
    for (let i = 0; i <= DOME_STEPS; i++) {
      const t = (i / DOME_STEPS) * tMax;
      out.push([R * Math.cos(t), d.dome.z0 + d.dome.rise * Math.sin(t)]);
    }
  } else {
    for (let i = 0; i <= BEVEL_STEPS; i++) {
      const a = (i / BEVEL_STEPS) * (Math.PI / 2);
      out.push([R - f * (1 - Math.cos(a)), d.H - f + f * Math.sin(a)]);
    }
  }
  out.push([0, out[out.length - 1][1]]);
  return dedupe(out);
}

/** Closed half-profile of a round template's cavity (the air inside). */
function latheCavityProfile(d: EnclosureDims): Vec2[] {
  const Ri = d.W / 2 - d.wall;
  if (Ri <= 0.5) return [];
  if (!d.dome) return [[0, d.floorZ], [Ri, d.floorZ], [Ri, d.H - d.wall], [0, d.H - d.wall]];
  // The ceiling follows innerTopAt, so the dome shell stays ≥ wall thick everywhere.
  const out: Vec2[] = [[0, d.floorZ], [Ri, d.floorZ], [Ri, innerTopAt(d, 0, Ri)]];
  for (let i = DOME_STEPS; i >= 0; i--) {
    const rho = (Ri * i) / DOME_STEPS;
    out.push([rho, innerTopAt(d, 0, rho)]);
  }
  return dedupe(out);
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
  }
  return out;
}

const isRound = (d: EnclosureDims) => d.shape === "circle";

function outerSolid(k: K, d: EnclosureDims): Manifold {
  if (isRound(d)) return latheSolid(k, { type: "lathe", outline: latheProfile(d), segments: LATHE_SEGS });
  const m = hullOf(k, d, slabSlices(0, d.H, d.edgeFillet), 0);
  // enclosureDims() never returns a footprint under LIMITS.minFootprint, so this
  // cannot happen — but a silent empty solid would leave the viewer with nothing.
  if (!m) throw new Error(`enclosure outline collapsed (${d.template} ${d.W}x${d.D})`);
  return m;
}

function cavitySolid(k: K, d: EnclosureDims): Manifold | null {
  if (isRound(d)) {
    const outline = latheCavityProfile(d);
    if (outline.length < 3) return null;
    return latheSolid(k, { type: "lathe", outline, segments: LATHE_SEGS });
  }
  return hullOf(k, d, [{ inset: d.wall, z: d.floorZ }, { inset: d.wall, z: d.H - d.wall }], d.wall);
}

// ---------------------------------------------------------------------------
// The lid's lip (a hanging ring that slides into the base, plus its flange)
// ---------------------------------------------------------------------------

/** The cross-section inset by `inset`, extruded from z0 to z1 (nothing is filleted). */
function shaft(k: K, d: EnclosureDims, inset: number, z0: number, z1: number): Manifold | null {
  const outline = planOutline(d, inset, d.wall);
  if (outline.length < 3 || z1 - z0 <= 0.01) return null;
  return k.a.t(k.a.t(cs(k, [outline]).extrude(z1 - z0)).translate([0, 0, z0]));
}

function lipSolid(k: K, d: EnclosureDims): Manifold | null {
  const s = d.splitZ;
  const out = d.wall + LIP.gap;
  const inn = out + LIP.thickness;
  const zm = s + 0.6;
  const ring = [shaft(k, d, out, s - LIP.height, zm), shaft(k, d, inn, s - LIP.height, zm)] as const;
  const flange = [shaft(k, d, d.wall / 2, zm, zm + LIP.flange), shaft(k, d, inn, zm, zm + LIP.flange)] as const;
  const parts: Manifold[] = [];
  if (ring[0] && ring[1]) parts.push(k.a.t(ring[0].subtract(ring[1])));
  if (flange[0] && flange[1]) parts.push(k.a.t(flange[0].subtract(flange[1])));
  if (!parts.length) return null;
  return union(k, parts);
}

// ---------------------------------------------------------------------------
// Cut-outs
// ---------------------------------------------------------------------------

function hexOutline(d: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    out.push([(d / 2) * Math.cos(a), (d / 2) * Math.sin(a)]);
  }
  return out;
}

/** One arc slot with round ends (grille vents), in the cut-out's own (u, v). */
function arcOutline(a: NonNullable<Cutout["arc"]>): Vec2[] {
  const hw = a.width / 2;
  const steps = Math.max(6, Math.ceil((Math.abs(a.a1 - a.a0) * (a.r + hw)) / 0.6));
  const at = (t: number, r: number): Vec2 => [a.cu + r * Math.cos(t), a.cv + r * Math.sin(t)];
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) out.push(at(a.a0 + ((a.a1 - a.a0) * i) / steps, a.r + hw));
  // Round cap at the a1 end, then back along the inner arc, then the a0 cap.
  const e1 = at(a.a1, a.r);
  for (let i = 1; i < 8; i++) {
    const t = a.a1 + (Math.PI * i) / 8;
    out.push([e1[0] + hw * Math.cos(t), e1[1] + hw * Math.sin(t)]);
  }
  for (let i = steps; i >= 0; i--) out.push(at(a.a0 + ((a.a1 - a.a0) * i) / steps, Math.max(0.05, a.r - hw)));
  const e0 = at(a.a0, a.r);
  for (let i = 1; i < 8; i++) {
    const t = a.a0 + Math.PI + (Math.PI * i) / 8;
    out.push([e0[0] + hw * Math.cos(t), e0[1] + hw * Math.sin(t)]);
  }
  return dedupe(out);
}

/** Keyhole: head circle at v = headV, slot of slotW running along −v. */
function keyholeOutline(k: NonNullable<Cutout["keyhole"]>): Vec2[] {
  const R = k.headD / 2;
  const sw = k.slotW / 2;
  const yc = Math.sqrt(Math.max(0, R * R - sw * sw));
  const t = Math.atan2(yc, sw);
  const out: Vec2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = -t + ((Math.PI + 2 * t) * i) / steps;
    out.push([R * Math.cos(a), k.headV + R * Math.sin(a)]);
  }
  out.push([-sw, k.headV - k.slotL]);
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (Math.PI * i) / 10;
    out.push([sw * Math.cos(a), k.headV - k.slotL + sw * Math.sin(a)]);
  }
  out.push([sw, k.headV - yc]);
  return dedupe(out);
}

/** "+" outline (12 corners): bars of half-span `arm` and thickness `thick`. */
function plusBars(arm: number, thick: number): [Vec2[], Vec2[]] {
  const h = thick / 2;
  return [
    [[-arm, -h], [arm, -h], [arm, h], [-arm, h]],
    [[-h, -arm], [h, -arm], [h, arm], [-h, arm]],
  ];
}

/** Place a local (u, v, axis) solid into enclosure space. */
function place(k: K, m: Manifold, c: Cutout): Manifold {
  const axis = c.axis ?? c.normal;
  return k.a.t(m.transform(frameMat(c.u, c.v, axis, c.center)));
}

function extrudeCentred(k: K, outline: Vec2[], depth: number): Manifold {
  return k.a.t(cs(k, [outline]).extrude(depth, 0, 0, [1, 1], true));
}

function cutSolid(k: K, c: Cutout): Manifold | null {
  const half = c.depth / 2;
  if (c.bevel !== undefined && c.outerAt !== undefined) {
    // Louvre: a straight slot that widens at 45° from just inside the outer surface.
    const zs = Math.max(-half + 0.1, c.outerAt - c.bevel);
    const grow = half - zs;
    const r0 = Math.min(c.radius, c.w / 2, c.h / 2);
    const pts: Vec3[] = [];
    const ring = (inset: number, z: number) => {
      for (const [x, y] of rrectOutline(Math.max(0.2, c.w - 2 * inset), Math.max(0.2, c.h - 2 * inset), Math.max(0.2, r0 - inset), 4)) {
        pts.push([x, y, z]);
      }
    };
    ring(0, -half);
    ring(0, zs);
    ring(-grow, half);
    return place(k, k.a.t(k.mf.Manifold.hull(pts)), c);
  }
  if (c.shape === "grille" && c.holes?.length) {
    const holes = c.holes.map((hole) =>
      k.a.t(extrudeCentred(k, ellipseOutline(hole.d, hole.d, 16), c.depth).translate([hole.u, hole.v, 0])),
    );
    return place(k, union(k, holes), c);
  }
  let outline: Vec2[];
  if (c.shape === "arc" && c.arc) outline = arcOutline(c.arc);
  else if (c.shape === "keyhole" && c.keyhole) outline = keyholeOutline(c.keyhole);
  else if (c.shape === "hex") outline = hexOutline(c.w);
  else if (c.shape === "circle") outline = ellipseOutline(c.w, c.w, 24);
  else outline = rrectOutline(c.w, c.h, Math.min(c.radius, c.w / 2 - 0.01, c.h / 2 - 0.01), 4);
  if (outline.length < 3) return null;
  return place(k, extrudeCentred(k, outline, c.depth), c);
}

/** stake_pod: the socket cut up into the thick floor from below. */
function socketSolid(k: K, d: EnclosureDims): Manifold | null {
  if (!d.stake) return null;
  const s = d.stake.socket;
  const bars = plusBars(s.arm, s.thick).map((bar) => k.a.t(k.a.t(cs(k, [bar]).extrude(s.depth + 1)).translate([0, 0, -1])));
  return union(k, bars);
}

/**
 * The soil spike: a constant "+" peg that pushes into the socket, then a taper to a
 * point below z = 0. Printed on its own, flat peg end down (it only narrows upwards).
 */
function spikeSolid(k: K, d: EnclosureDims): Manifold | null {
  if (!d.stake) return null;
  const s = d.stake;
  const tip = { arm: s.thick / 2 + 0.4, thick: Math.max(1.2, s.thick * 0.6) };
  const bars = plusBars(s.arm, s.thick);
  const tips = plusBars(tip.arm, tip.thick);
  const parts = bars.map((bar, i) => {
    const pts: Vec3[] = [];
    for (const [x, y] of bar) {
      pts.push([x, y, s.peg], [x, y, 0]);
    }
    for (const [x, y] of tips[i]) pts.push([x, y, -s.length]);
    return k.a.t(k.mf.Manifold.hull(pts));
  });
  return union(k, parts);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Build one template case: the printable base, the lid (with the raised name and the
 * lip) and — for a stake pod — the soil spike. `mf` is an initialised manifold-3d
 * module (loadManifold()). Never mutates `plan`.
 */
export function buildEnclosureCase(mf: ManifoldToplevel, plan: EnclosurePlan): BuiltCase {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const k: K = { mf, a: new Arena() };
  try {
    const d = plan.dims;
    const parts: Manifold[] = [outerSolid(k, d)];
    if (plan.label.plan) {
      // The raised letters join the outer solid before it is hollowed, so the label
      // ends up in the lid's own mesh (it always sits above splitZ).
      for (const c of labelCapsules(plan.label.plan, d)) {
        const a = k.a.t(k.a.t(mf.Manifold.sphere(c.r, 12)).translate(c.a));
        const b = k.a.t(k.a.t(mf.Manifold.sphere(c.r, 12)).translate(c.b));
        parts.push(k.a.t(mf.Manifold.hull([a, b])));
      }
    }
    let shell = union(k, parts);
    const cav = cavitySolid(k, d);
    if (cav) shell = k.a.t(shell.subtract(cav));

    const cutters: Manifold[] = [];
    for (const c of [...plan.cutouts, ...plan.keyholes, ...plan.vents]) {
      const m = cutSolid(k, c);
      if (m) cutters.push(m);
    }
    const socket = socketSolid(k, d);
    if (socket) cutters.push(socket);
    const cuts = cutters.length ? union(k, cutters) : null;
    if (cuts) shell = k.a.t(shell.subtract(cuts));

    const [above, below] = shell.splitByPlane([0, 0, 1], d.splitZ);
    k.a.t(above);
    k.a.t(below);
    let lid: Manifold = above;
    const lip = lipSolid(k, d);
    if (lip) lid = union(k, [lid, cuts ? k.a.t(lip.subtract(cuts)) : lip]);

    const baseArrays = meshArrays(k, below);
    const lidArrays = meshArrays(k, lid);
    const spike = spikeSolid(k, d);
    const spikeArrays = spike ? meshArrays(k, spike) : null;
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    const triangles =
      baseArrays.indices.length / 3 + lidArrays.indices.length / 3 + (spikeArrays ? spikeArrays.indices.length / 3 : 0);
    return {
      base: baseArrays,
      lid: lidArrays,
      spike: spikeArrays,
      checks: {
        base: checkPrintable(baseArrays),
        lid: checkPrintable(lidArrays),
        spike: spikeArrays ? checkPrintable(spikeArrays) : null,
      },
      triangles,
      ms,
    };
  } finally {
    k.a.free();
  }
}
