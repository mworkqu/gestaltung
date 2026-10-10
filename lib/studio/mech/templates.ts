// Printable mechanical part geometry (Phase 2). One builder per MechTemplate,
// from CLAMPED params only (schema.ts MECH_PARAMS). Units mm, Z up, part-local:
// every part is centred on its own XY origin and starts at z = 0 (bottom on the
// print bed), except where noted. Pure three.js, deterministic, runs in vitest.
//
// Bodies are closed solids: revolved profiles (analytic normals) or extruded
// shapes with a small bevel (bevelOffset = −bevel keeps the outer size exact)
// and creased normals. A part made of several bodies is merged into ONE
// non-indexed geometry (position + normal), outward-facing (positive volume).
//
// lid / base: the real printable lid and base are the enclosure meshes
// (build.ts uses them when given); the builders here are the plain fallback.

import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MECH_PARAMS, clampMechPart, type MechPart, type MechTemplate } from "../schema";

export type MechParams = Record<string, number>;
type P2 = [number, number];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Signed volume (mm³) of a closed triangle mesh: Σ p0·(p1×p2) / 6. */
export function signedVolume(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute("position");
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  let v = 0;
  const at = (i: number) => (idx ? idx.getX(i) : i);
  for (let i = 0; i + 2 < n; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function triangleCount(g: THREE.BufferGeometry): number {
  return (g.getIndex() ? g.getIndex()!.count : g.getAttribute("position").count) / 3;
}

/** Non-indexed, position + normal only, outward winding. */
function clean(g: THREE.BufferGeometry, crease: boolean): THREE.BufferGeometry {
  let out = g.getIndex() ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal") out.deleteAttribute(name);
  if (signedVolume(out) < 0) {
    for (const name of Object.keys(out.attributes)) {
      const a = out.getAttribute(name) as THREE.BufferAttribute;
      const s = a.itemSize;
      const arr = a.array as Float32Array;
      for (let t = 0; t + 3 * s <= arr.length; t += 3 * s) {
        for (let k = 0; k < s; k++) {
          const tmp = arr[t + s + k];
          arr[t + s + k] = arr[t + 2 * s + k];
          arr[t + 2 * s + k] = tmp;
        }
      }
      a.needsUpdate = true;
    }
  }
  if (crease) {
    out = toCreasedNormals(out, Math.PI / 5);
    for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal") out.deleteAttribute(name);
  }
  return out;
}

/**
 * Solid of revolution about +z from a closed (r, z) profile listed CCW
 * (r right, z up). Each profile edge gets its own analytic normal, so chamfers
 * stay crisp while the round stays smooth.
 */
function revolve(profile: P2[], segs = 32): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const n = profile.length;
  const cs = Array.from({ length: segs + 1 }, (_, s) => (s === segs ? [1, 0] : [Math.cos((2 * Math.PI * s) / segs), Math.sin((2 * Math.PI * s) / segs)]));
  for (let i = 0; i < n; i++) {
    const [r0, z0] = profile[i];
    const [r1, z1] = profile[(i + 1) % n];
    if (r0 <= 1e-9 && r1 <= 1e-9) continue;
    const dr = r1 - r0, dz = z1 - z0;
    const L = Math.hypot(dr, dz);
    if (L < 1e-9) continue;
    const nr = dz / L, nz = -dr / L;
    for (let s = 0; s < segs; s++) {
      const [c0, s0] = cs[s];
      const [c1, s1] = cs[s + 1];
      const A = [r0 * c0, r0 * s0, z0], B = [r1 * c0, r1 * s0, z1], C = [r1 * c1, r1 * s1, z1], D = [r0 * c1, r0 * s1, z0];
      const nA = [nr * c0, nr * s0, nz], nC = [nr * c1, nr * s1, nz];
      if (r1 > 1e-9) { pos.push(...A, ...C, ...B); nor.push(...nA, ...nC, ...nA); }
      if (r0 > 1e-9) { pos.push(...A, ...D, ...C); nor.push(...nA, ...nC, ...nC); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return clean(g, false);
}

/** Quarter-arc fillet points from (r, z-f) around centre (r-f, z-f) up to (r-f, z). */
function fillet(r: number, z: number, f: number, steps = 4): P2[] {
  const out: P2[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = (Math.PI / 2) * (k / steps);
    out.push([r - f + f * Math.cos(a), z - f + f * Math.sin(a)]);
  }
  return out;
}

/** Rounded rectangle path (r clamped to the half sides), centred at (cx, cy). */
function rrect<T extends THREE.Path>(p: T, w: number, h: number, r: number, cx = 0, cy = 0): T {
  const rr = Math.max(0.01, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  p.moveTo(x0 + rr, y0);
  p.lineTo(x1 - rr, y0);
  p.absarc(x1 - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - rr);
  p.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  p.lineTo(x0 + rr, y1);
  p.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + rr);
  p.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  return p;
}

const shapeRRect = (w: number, h: number, r: number, cx = 0, cy = 0) => rrect(new THREE.Shape(), w, h, r, cx, cy);
const holeRRect = (w: number, h: number, r: number, cx = 0, cy = 0) => rrect(new THREE.Path(), w, h, r, cx, cy);
const holeCircle = (r: number, cx: number, cy: number) => new THREE.Path().absarc(cx, cy, r, 0, Math.PI * 2, false);

const polyShape = (pts: P2[]) => {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
};

/**
 * Extrude a shape along local z over [0, depth] with a bevel of `b` (outer size
 * stays exact: bevelOffset = −b). Returns the raw ExtrudeGeometry (z ∈ [0, depth]).
 */
function extrude(shape: THREE.Shape, depth: number, b: number, curveSegments = 8): THREE.BufferGeometry {
  const bb = Math.max(0, Math.min(b, depth / 2 - 0.02));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, depth - 2 * bb),
    bevelEnabled: bb > 0,
    bevelThickness: bb,
    bevelSize: bb,
    bevelOffset: -bb,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, bb > 0 ? bb : 0);
  return g;
}

/** Horizontal slab: shape in XY, z ∈ [z0, z0 + h]. */
function slab(shape: THREE.Shape, z0: number, h: number, b: number): THREE.BufferGeometry {
  const g = extrude(shape, h, b);
  g.translate(0, 0, z0);
  return g;
}

/** Vertical plate: shape in (x, z), thickness t along −y (y ∈ [−t, 0]). */
function plateXZ(shape: THREE.Shape, t: number, b: number): THREE.BufferGeometry {
  const g = extrude(shape, t, b);
  g.rotateX(Math.PI / 2); // shape y → z, extrude z → −y
  return g;
}

function merge(bodies: THREE.BufferGeometry[], crease = true): THREE.BufferGeometry {
  const parts = bodies.map((b) => clean(b, crease));
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Hollow cylinder; chamfered top + bore lead-in. z ∈ [0, height]. */
function standoff(p: MechParams): THREE.BufferGeometry {
  const h = p.height;
  const ri = p.holeD / 2;
  const ro = Math.max(p.outerD / 2, ri + 0.8);
  const c = Math.min(0.6, (ro - ri) / 3, h / 4);
  const lead = Math.min(0.3, (ro - ri) / 4, h / 6);
  const g = revolve([
    [ri, 0], [ro, 0], [ro, h - c], [ro - c, h], [ri + lead, h], [ri, h - lead],
  ], 32);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Tray for a board (width × depth inside) with two side rails and slotted lips. */
function pcbCradle(p: MechParams): THREE.BufferGeometry {
  const { width, depth, railHeight, wall } = p;
  const Wo = width + 2 * wall;
  const floor = slab(shapeRRect(Wo, depth, Math.min(2, depth / 4)), 0, wall, Math.min(0.4, wall / 3));
  const lip = 1.2, lipT = 1.2;
  const top = wall + railHeight + lipT;
  const rail = (sgn: 1 | -1) => {
    const x = (v: number) => sgn * v;
    const s = polyShape([
      [x(width / 2), wall], [x(width / 2 + wall), wall], [x(width / 2 + wall), top],
      [x(width / 2 - lip), top], [x(width / 2 - lip), wall + railHeight], [x(width / 2), wall + railHeight],
    ]);
    const g = plateXZ(s, depth, 0.3);
    g.translate(0, depth / 2, 0);
    return g;
  };
  return merge([floor, rail(1), rail(-1)]);
}

/** U-cradle for a round cell (axis along x) with two inward snap lips. */
function batteryClip(p: MechParams): THREE.BufferGeometry {
  const R = p.cellD / 2;
  const w = p.wall;
  const Ro = R + w;
  const zc = Ro;
  const a = (35 * Math.PI) / 180;
  const lipIn = Math.min(0.9, R * 0.12);
  const d = (8 * Math.PI) / 180;
  const at = (r: number, ang: number): P2 => [r * Math.cos(ang), zc + r * Math.sin(ang)];
  const arc = (r: number, a0: number, a1: number, n: number): P2[] =>
    Array.from({ length: n + 1 }, (_, k) => at(r, a0 + ((a1 - a0) * k) / n));
  // Explicit polygon (no duplicate points): floor block, outer arcs, two snap lips, inner arc.
  const s = polyShape([
    [-Ro, 0], [Ro, 0],
    ...arc(Ro, 0, a, 8),
    at(R - lipIn, a),
    ...arc(R, a - d, Math.PI - a + d - 2 * Math.PI, 28),
    at(R - lipIn, Math.PI - a),
    ...arc(Ro, Math.PI - a, Math.PI, 8),
  ]);
  const L = Math.max(10, p.length * 0.8);
  const g = extrude(s, L, Math.min(0.3, w / 6), 10);
  // shape (x, y) + extrude z → world (y, z, x): cyclic permutation, det +1.
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  g.translate(-L / 2, 0, 0);
  return merge([g]);
}

/** L-bracket: foot + upright with a window, upright tilted back by `tilt`°. */
function sensorMount(p: MechParams): THREE.BufferGeometry {
  const { width, height, tilt, wall } = p;
  const footD = Math.max(10, height * 0.4);
  const b = Math.min(0.5, wall / 3);
  const foot = slab(shapeRRect(width, footD, Math.min(3, footD / 3)), 0, wall, b);
  foot.translate(0, footD / 2 - wall, 0);
  const up = shapeRRect(width, height, Math.min(3, width / 4, height / 4), 0, height / 2);
  const m = Math.max(wall * 1.5, 3);
  const ww = width - 2 * m, wh = height * 0.4;
  if (ww >= 3 && wh >= 3) up.holes.push(holeRRect(ww, wh, Math.min(2, ww / 3, wh / 3), 0, height * 0.55));
  const upright = plateXZ(up, wall, b);
  upright.rotateX((-tilt * Math.PI) / 180);
  const g = merge([foot, upright]);
  g.translate(0, -(footD / 2 - wall), 0);
  g.computeBoundingBox();
  return g;
}

/** Open ring (cable along y) on a base pad. */
function cableClip(p: MechParams): THREE.BufferGeometry {
  const r = p.cableD / 2;
  const t = Math.max(1.2, p.cableD * 0.25);
  const ro = r + t;
  const padT = 1.6;
  const zc = padT + ro - 0.4;
  const gam = (35 * Math.PI) / 180;
  const s = new THREE.Shape();
  s.moveTo(ro * Math.cos(Math.PI / 2 + gam), zc + ro * Math.sin(Math.PI / 2 + gam));
  s.absarc(0, zc, ro, Math.PI / 2 + gam, Math.PI / 2 - gam, false);
  s.lineTo(r * Math.cos(Math.PI / 2 - gam), zc + r * Math.sin(Math.PI / 2 - gam));
  s.absarc(0, zc, r, Math.PI / 2 - gam, Math.PI / 2 + gam, true);
  s.closePath();
  const ring = plateXZ(s, p.width, Math.min(0.4, t / 3));
  ring.translate(0, p.width / 2, 0);
  const padW = 2 * ro + 6;
  const pad = slab(shapeRRect(padW, p.width, Math.min(2, p.width / 3)), 0, padT, 0.4);
  return merge([pad, ring]);
}

/** Round cap + stem, with a retaining flange at the bottom (sits on the button). */
function buttonExtender(p: MechParams): THREE.BufferGeometry {
  const rc = p.capD / 2;
  const rs = Math.max(1.2, Math.min(p.capD * 0.3, rc - 1));
  const rf = rc + 1;
  const L = p.length;
  const capT = 2.5;
  const f = Math.min(1, rc / 3, capT / 2);
  const g = revolve([
    [0, 0], [rf, 0], [rf, 1], [rs, 1], [rs, 1 + L], [rc, 1 + L], ...fillet(rc, 1 + L + capT, f), [0, 1 + L + capT],
  ], 32);
  g.computeBoundingBox();
  return g;
}

/** Clear rod with a base flange and a softened tip. */
function lightPipe(p: MechParams): THREE.BufferGeometry {
  const r = p.d / 2;
  const L = Math.max(p.length, 2);
  const rf = r + 1;
  const ft = Math.min(1, L / 3);
  const c = Math.min(0.4, r / 3, (L - ft) / 3);
  const g = revolve([[0, 0], [rf, 0], [rf, ft], [r, ft], ...fillet(r, L, c, 3), [0, L]], 24);
  g.computeBoundingBox();
  return g;
}

/** Keyhole slot: head circle radius R at (cx, cz), slot width 2·rs going up by s. */
function keyhole(R: number, rs: number, s: number, cx: number, cz: number): THREE.Path {
  const p = new THREE.Path();
  const k = Math.sqrt(R * R - rs * rs);
  p.moveTo(cx + rs, cz + k);
  p.lineTo(cx + rs, cz + s);
  p.absarc(cx, cz + s, rs, 0, Math.PI, false);
  p.lineTo(cx - rs, cz + k);
  p.absarc(cx, cz, R, Math.atan2(k, -rs), Math.atan2(k, rs), false);
  return p;
}

/** Wall plate (x × z, thickness along −y) with keyholes, screw holes and a front lip. */
function wallBracket(p: MechParams): THREE.BufferGeometry {
  const { width, height, holeD, thickness: t } = p;
  const R = Math.min(holeD, width / 8, height / 8);
  const rs = Math.min(holeD / 2, R * 0.6);
  const sLen = R * 1.2;
  const margin = R + 2;
  const plate = shapeRRect(width, height, Math.min(4, width / 5, height / 5), 0, height / 2);
  const cx = width / 2 - margin;
  const cz = height - margin - sLen;
  plate.holes.push(keyhole(R, rs, sLen, -cx, cz), keyhole(R, rs, sLen, cx, cz));
  const hr = Math.min(holeD / 2, R);
  if (cz - R - (margin + hr) > 2) plate.holes.push(holeCircle(hr, -cx, margin), holeCircle(hr, cx, margin));
  const b = Math.min(0.5, t / 3);
  const body = plateXZ(plate, t, b);
  const lipD = 8;
  const lip = slab(shapeRRect(width, lipD + 0.4, Math.min(2, lipD / 3)), 0, t, b);
  lip.translate(0, lipD / 2 - 0.2, 0);
  const stop = slab(shapeRRect(width, t, Math.min(1, t / 3)), t - 0.2, 3, Math.min(0.4, t / 4));
  stop.translate(0, lipD - t / 2, 0);
  return merge([body, lip, stop]);
}

/** Fallback lid: rounded plate width × depth × thickness. */
function lidPlate(p: MechParams): THREE.BufferGeometry {
  const s = shapeRRect(p.width, p.depth, Math.min(8, Math.min(p.width, p.depth) / 4));
  return merge([slab(s, 0, p.thickness, Math.min(1, p.thickness / 3))]);
}

/** Fallback base: open-top rounded shell, 2 mm walls and floor. */
function baseShell(p: MechParams): THREE.BufferGeometry {
  const t = 2;
  const r = Math.min(8, Math.min(p.width, p.depth) / 4);
  const ring = shapeRRect(p.width, p.depth, r);
  ring.holes.push(holeRRect(p.width - 2 * t, p.depth - 2 * t, Math.max(0.5, r - t)));
  const walls = slab(ring, 0, p.height, 0.6);
  const floor = slab(shapeRRect(p.width - 2 * t, p.depth - 2 * t, Math.max(0.5, r - t)), 0, t, 0);
  return merge([walls, floor]);
}

export const MECH_BUILDERS: Record<MechTemplate, (p: MechParams) => THREE.BufferGeometry> = {
  standoff,
  pcb_cradle: pcbCradle,
  battery_clip: batteryClip,
  sensor_mount: sensorMount,
  cable_clip: cableClip,
  button_extender: buttonExtender,
  light_pipe: lightPipe,
  wall_bracket: wallBracket,
  lid: lidPlate,
  base: baseShell,
};

/** Clamp a param record to MECH_PARAMS (defaults for missing / bad values). */
export function clampParams(template: MechTemplate, params: Record<string, unknown> = {}): MechParams {
  const out: MechParams = {};
  for (const [k, [min, max, def]] of Object.entries(MECH_PARAMS[template])) {
    const v = params[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  }
  return out;
}

/** Geometry of one mech part (params re-clamped, so any input is safe). */
export function buildMechGeometry(part: Pick<MechPart, "template" | "params">): THREE.BufferGeometry {
  return MECH_BUILDERS[part.template](clampParams(part.template, part.params));
}

/** Clamp an arbitrary value with the schema, then build (null when the template is unknown). */
export function buildMechGeometryLoose(input: unknown): THREE.BufferGeometry | null {
  const part = clampMechPart(input);
  return part ? buildMechGeometry(part) : null;
}
