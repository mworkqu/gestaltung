// Enclosure geometry: EnclosureSpec + layout → two printable meshes
// ("enclosure_base", "enclosure_lid"). Pure three.js + three-bvh-csg, so it runs
// in the viewer, in STL export and in vitest (node).
//
// How it is built:
//  * every solid is a "sweep": a closed outline (rounded rect / stadium / circle)
//    swept along a side profile (bevel arcs = the edge fillet). Normals are
//    analytic, so curved surfaces shade smoothly and flat faces stay flat;
//  * soft_wedge and handheld_taper are smooth deformations of that sweep
//    (top shifted along a tilted plane / cross-section scaled along the long
//    axis) with the normals transformed by the inverse-transpose Jacobian;
//  * shell = outer − cavity − (all cut-outs merged into ONE brush);
//  * split at splitZ into base and lid with one multi-operation evaluate;
//  * the lid gets a lip ring (0.4 mm gap to the base wall, ~3 mm deep) joined
//    by a flange hidden inside the lid wall;
//  * feet are separate dark child meshes of the base (bought rubber pads).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import type { EnclosureSpec, LayoutItem, LibraryPart } from "../schema";
import type { LayoutResult } from "../layout";
import { cutoutsFor, ventCutouts, type Cutout } from "./cutouts";
import {
  LIP,
  enclosureDims,
  exitDistance,
  settlePokes,
  outlineAt,
  taperScale,
  taperSlope,
  wedgeShift,
  type EnclosureDims,
} from "./templates";

export type EnclosureMeta = {
  W: number;
  D: number;
  H: number;
  splitZ: number;
  dims: EnclosureDims;
  cutouts: Cutout[];
  vents: Cutout[];
  /** The layout the case was cut for: poke-through sensors lifted to the lid (render parts with THIS). */
  layout: LayoutItem[];
  triangles: number;
  ms: number;
};

export type BuiltEnclosure = { base: THREE.Mesh; lid: THREE.Mesh; meta: EnclosureMeta };

type P2 = [number, number];
type Outline = { pts: P2[]; nrm: P2[] };
type ProfilePt = { inset: number; z: number; nr: number; nz: number };

const CORNER_SEGS = { rrect: 8, stadium: 10, circle: 16 } as const;
const BEVEL_SEGS = 3;

// ---------------------------------------------------------------------------
// Outlines + sweeps
// ---------------------------------------------------------------------------

/** Rounded rectangle (stadium / circle when r reaches the half sides), CCW from +x. */
function roundedOutline(hw: number, hd: number, r: number, segs: number): Outline {
  const centres: [number, number, number][] = [
    [hw - r, hd - r, 0],
    [-(hw - r), hd - r, Math.PI / 2],
    [-(hw - r), -(hd - r), Math.PI],
    [hw - r, -(hd - r), (3 * Math.PI) / 2],
  ];
  const pts: P2[] = [];
  const nrm: P2[] = [];
  for (const [cx, cy, a0] of centres) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const p: P2 = [cx + r * c, cy + r * s];
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-6) continue;
      pts.push(p);
      nrm.push([c, s]);
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) {
    pts.pop();
    nrm.pop();
  }
  return { pts, nrm };
}

function hexOutline(d: number): Outline {
  const pts: P2[] = [];
  const nrm: P2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push([(d / 2) * Math.cos(a), (d / 2) * Math.sin(a)]);
    nrm.push([Math.cos(a), Math.sin(a)]);
  }
  return { pts, nrm };
}

/**
 * Sweep an outline (function of inset) along profile chains. Each chain is a
 * smooth run of profile points (shared vertices); chains meet at sharp edges.
 * Caps close the first / last point of the profile with a fan (outlines are convex).
 */
function sweep(outlineFor: (inset: number) => Outline, chains: ProfilePt[][], caps: { bottom: boolean; top: boolean }): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const ring = (p: ProfilePt): number => {
    const o = outlineFor(p.inset);
    const start = pos.length / 3;
    for (let j = 0; j < o.pts.length; j++) {
      pos.push(o.pts[j][0], o.pts[j][1], p.z);
      nor.push(o.nrm[j][0] * p.nr, o.nrm[j][1] * p.nr, p.nz);
    }
    return start;
  };
  const count = outlineFor(chains[0][0].inset).pts.length;
  for (const chain of chains) {
    const starts = chain.map(ring);
    for (let k = 0; k + 1 < starts.length; k++) {
      const lo = starts[k];
      const hi = starts[k + 1];
      for (let j = 0; j < count; j++) {
        const j1 = (j + 1) % count;
        idx.push(lo + j, lo + j1, hi + j1, lo + j, hi + j1, hi + j);
      }
    }
  }
  const cap = (p: ProfilePt, up: boolean) => {
    const o = outlineFor(p.inset);
    const c = pos.length / 3;
    const nz = up ? 1 : -1;
    pos.push(0, 0, p.z);
    nor.push(0, 0, nz);
    for (const q of o.pts) {
      pos.push(q[0], q[1], p.z);
      nor.push(0, 0, nz);
    }
    for (let j = 0; j < count; j++) {
      const a = c + 1 + j;
      const b = c + 1 + ((j + 1) % count);
      if (up) idx.push(c, a, b);
      else idx.push(c, b, a);
    }
  };
  if (caps.bottom) cap(chains[0][0], false);
  if (caps.top) {
    const last = chains[chains.length - 1];
    cap(last[last.length - 1], true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Side profile of a slab z0..z1 with fillet f on the top and bottom edges. */
function slabProfile(z0: number, z1: number, f: number): ProfilePt[] {
  if (f <= 0) return [
    { inset: 0, z: z0, nr: 1, nz: 0 },
    { inset: 0, z: z1, nr: 1, nz: 0 },
  ];
  const out: ProfilePt[] = [];
  for (let i = 0; i <= BEVEL_SEGS; i++) {
    const a = (i / BEVEL_SEGS) * (Math.PI / 2);
    out.push({ inset: f * (1 - Math.sin(a)), z: z0 + f * (1 - Math.cos(a)), nr: Math.sin(a), nz: -Math.cos(a) });
  }
  for (let i = 0; i <= BEVEL_SEGS; i++) {
    const a = (i / BEVEL_SEGS) * (Math.PI / 2);
    out.push({ inset: f * (1 - Math.cos(a)), z: z1 - f + f * Math.sin(a), nr: Math.cos(a), nz: Math.sin(a) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deformations (taper / wedge)
// ---------------------------------------------------------------------------

function deform(g: THREE.BufferGeometry, d: EnclosureDims, inset: number): void {
  const ws = wedgeShift(d);
  if (!d.taper && !ws) return;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    let nx = nor.getX(i);
    let ny = nor.getY(i);
    let nz = nor.getZ(i);
    if (d.taper) {
      if (d.taper.axis === "x") {
        const s = taperScale(d, x, inset);
        const slope = taperSlope(d, x, inset);
        // y' = y·s(x) → n' = (nx − y·s'/s·ny, ny/s, nz)
        nx = nx - ((y * slope) / s) * ny;
        ny = ny / s;
        y = y * s;
      } else {
        const s = taperScale(d, y, inset);
        const slope = taperSlope(d, y, inset);
        ny = ny - ((x * slope) / s) * nx;
        nx = nx / s;
        x = x * s;
      }
    }
    if (ws) {
      const delta = (y - d.D / 2) * ws.slope;
      const t = Math.min(1, Math.max(0, (z - ws.zA) / (ws.zB - ws.zA)));
      const db = z > ws.zA && z < ws.zB ? 1 / (ws.zB - ws.zA) : 0;
      // z' = z + Δ(y)·b(z) → n' = (nx, ny − nz·Δ'b/(1+Δb'), nz/(1+Δb'))
      const den = 1 + delta * db;
      ny = ny - (nz * ws.slope * t) / den;
      nz = nz / den;
      z = z + delta * t;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    pos.setXYZ(i, x, y, z);
    nor.setXYZ(i, nx / l, ny / l, nz / l);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

function outlineFn(d: EnclosureDims, extraInset = 0): (inset: number) => Outline {
  const segs = CORNER_SEGS[d.shape];
  return (inset) => {
    const o = outlineAt(d, inset + extraInset);
    return roundedOutline(o.hw, o.hd, o.r, segs);
  };
}

function outerSolid(d: EnclosureDims): THREE.BufferGeometry {
  const g = sweep(outlineFn(d), [slabProfile(0, d.H, d.edgeFillet)], { bottom: true, top: true });
  deform(g, d, 0);
  return g;
}

function cavitySolid(d: EnclosureDims): THREE.BufferGeometry {
  const g = sweep(outlineFn(d, d.wall), [slabProfile(d.floorZ, d.H - d.wall, 0)], { bottom: true, top: true });
  deform(g, d, d.wall);
  return g;
}

/** Lid lip: hanging ring (gap to the base wall) + flange buried in the lid wall. */
function lipSolid(d: EnclosureDims): THREE.BufferGeometry {
  const s = d.splitZ;
  const out = d.wall + LIP.gap;
  const inn = d.wall + LIP.gap + LIP.thickness;
  const fl = d.wall / 2;
  const z0 = s - LIP.height;
  const zm = s + 0.6;
  const z1 = s + 0.6 + LIP.flange;
  const P = (inset: number, z: number, nr: number, nz: number): ProfilePt => ({ inset, z, nr, nz });
  const chains: ProfilePt[][] = [
    [P(out, z0, 1, 0), P(out, zm, 1, 0)],
    [P(out, zm, 0, -1), P(fl, zm, 0, -1)],
    [P(fl, zm, 1, 0), P(fl, z1, 1, 0)],
    [P(fl, z1, 0, 1), P(inn, z1, 0, 1)],
    [P(inn, z1, -1, 0), P(inn, z0, -1, 0)],
    [P(inn, z0, 0, -1), P(out, z0, 0, -1)],
  ];
  const g = sweep(outlineFn(d), chains, { bottom: false, top: false });
  // Taper uses the cavity's scale (the ring lives just inside the cavity wall).
  // The lip sits below the wedge's shifted zone, so only the taper applies.
  if (d.taper) deform(g, { ...d, wedgeDeg: undefined }, d.wall);
  return g;
}

/** Cutting prism for one cut-out, positioned in enclosure space. */
function cutGeometry(c: Cutout): THREE.BufferGeometry {
  const half = c.depth / 2;
  const prism = (o: Outline) =>
    sweep(() => o, [[{ inset: 0, z: -half, nr: 1, nz: 0 }, { inset: 0, z: half, nr: 1, nz: 0 }]], { bottom: true, top: true });
  let g: THREE.BufferGeometry;
  if (c.shape === "grille" && c.holes?.length) {
    const parts = c.holes.map((hole) => {
      const p = prism(roundedOutline(hole.d / 2, hole.d / 2, hole.d / 2, 3));
      p.translate(hole.u, hole.v, 0);
      return p;
    });
    g = mergeGeometries(parts)!;
  } else if (c.shape === "hex") {
    g = prism(hexOutline(c.w));
  } else if (c.shape === "circle") {
    g = prism(roundedOutline(c.w / 2, c.w / 2, c.w / 2, 4));
  } else {
    g = prism(roundedOutline(c.w / 2, c.h / 2, Math.min(c.radius, c.w / 2, c.h / 2), 3));
  }
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...c.u),
    new THREE.Vector3(...c.v),
    new THREE.Vector3(...c.normal),
  );
  m.setPosition(...c.center);
  g.applyMatrix4(m);
  return g;
}

// ---------------------------------------------------------------------------
// CSG helpers
// ---------------------------------------------------------------------------

function brush(g: THREE.BufferGeometry): Brush {
  const b = new Brush(g);
  b.updateMatrixWorld();
  return b;
}

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const nor = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (nor) {
    for (let i = 0; i < nor.count; i++) {
      const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i)) || 1;
      nor.setXYZ(i, nor.getX(i) / l, nor.getY(i) / l, nor.getZ(i) / l);
    }
  } else {
    g.computeVertexNormals();
  }
  g.clearGroups();
  const n = g.index ? g.index.count : g.getAttribute("position").count;
  g.addGroup(0, n, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

function feet(d: EnclosureDims, kind: EnclosureSpec["feet"]): THREE.Mesh[] {
  if (kind === "none") return [];
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f2125, roughness: 0.9, metalness: 0 });
  if (kind === "ring") {
    const R = Math.max(4, Math.min(d.W, d.D) / 2 - Math.max(6, d.cornerRadius * 0.4));
    const g = new THREE.TorusGeometry(R, 1.2, 8, 64);
    g.scale(1, 1, 0.6);
    g.translate(0, 0, -0.35);
    const m = new THREE.Mesh(g, mat);
    m.name = "enclosure_feet";
    return [m];
  }
  const r = Math.max(3, Math.min(6, Math.min(d.W, d.D) * 0.06));
  const out: THREE.Mesh[] = [];
  const dirs: P2[] = [[d.W, d.D], [-d.W, d.D], [-d.W, -d.D], [d.W, -d.D]];
  dirs.forEach(([dx, dy], i) => {
    const l = Math.hypot(dx, dy);
    const t = exitDistance(d, 0, 0, dx / l, dy / l) - (r + 3 + d.edgeFillet);
    const g = new THREE.CylinderGeometry(r, r, 1.6, 24);
    g.rotateX(Math.PI / 2);
    g.translate((dx / l) * t, (dy / l) * t, -0.6);
    const m = new THREE.Mesh(g, mat);
    m.name = `enclosure_foot_${i + 1}`;
    out.push(m);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function buildEnclosure(spec: EnclosureSpec, layoutResult: LayoutResult, parts: Map<string, LibraryPart>): BuiltEnclosure {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const d = enclosureDims(spec, layoutResult);
  const placed = settlePokes(layoutResult.layout, parts, d);
  const cutouts = cutoutsFor(placed, parts, d);
  const vents = ventCutouts(spec, d, cutouts);

  const ev = new Evaluator();
  ev.attributes = ["position", "normal"];
  ev.useGroups = false;

  let shell = ev.evaluate(brush(outerSolid(d)), brush(cavitySolid(d)), SUBTRACTION);
  const cutGeos = [...cutouts, ...vents].map(cutGeometry);
  const cutBrush = cutGeos.length ? brush(mergeGeometries(cutGeos)!) : null;
  if (cutBrush) shell = ev.evaluate(shell, cutBrush, SUBTRACTION);

  const big = Math.max(d.W, d.D) * 2 + 20;
  const below = new THREE.BoxGeometry(big, big, d.splitZ + 20);
  below.translate(0, 0, d.splitZ - (d.splitZ + 20) / 2);
  below.deleteAttribute("uv");
  const [baseBrush, lidRaw] = ev.evaluate(shell, brush(below), [INTERSECTION, SUBTRACTION], [new Brush(), new Brush()]);

  let lip = brush(lipSolid(d));
  if (cutBrush) {
    const lipBox = new THREE.Box3().setFromBufferAttribute(lip.geometry.getAttribute("position") as THREE.BufferAttribute);
    const hits = cutGeos.filter((g) => {
      g.computeBoundingBox();
      return g.boundingBox!.intersectsBox(lipBox);
    });
    if (hits.length) lip = ev.evaluate(lip, brush(mergeGeometries(hits)!), SUBTRACTION);
  }
  const lidBrush = ev.evaluate(lidRaw, lip, ADDITION);

  const material = () => new THREE.MeshStandardMaterial({ color: 0xf2f0eb, roughness: 0.7, metalness: 0 });
  const base = new THREE.Mesh(finish(baseBrush.geometry), material());
  base.name = "enclosure_base";
  for (const f of feet(d, spec.feet)) base.add(f);
  const lid = new THREE.Mesh(finish(lidBrush.geometry), material());
  lid.name = "enclosure_lid";

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    base,
    lid,
    meta: {
      W: d.W,
      D: d.D,
      H: d.H,
      splitZ: d.splitZ,
      dims: d,
      cutouts,
      vents,
      layout: placed,
      triangles: triCount(base.geometry) + triCount(lid.geometry),
      ms: Math.round(t1 - t0),
    },
  };
}
