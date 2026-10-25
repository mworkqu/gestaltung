// Pure 2D / curve maths shared by the product solver and the geometry kernel
// (no three.js, no WASM): rounded outlines, the filleted lathe profile, the
// nozzle path, Catmull-Rom sampling and small vector / rotation helpers.
// The kernel builds its meshes from EXACTLY these outlines, so the bounding
// boxes the solver anchors with are the boxes the meshes really have.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Vectors + rotations (degrees, XYZ Euler applied X then Y then Z, like manifold-3d)
// ---------------------------------------------------------------------------

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/** Round to 1 µm (and turn −0 into 0) so results are stable between runs. */
export function r3(n: number): number {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
}
export const r3v = (v: Vec3): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

/** 3×3 rotation matrix (row-major) for Euler degrees [rx, ry, rz], applied X, then Y, then Z. */
export function rotationMatrix(rot: Vec3 | undefined): number[] {
  const [ax, ay, az] = (rot ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz · Ry · Rx
  const snap = (n: number) => (Math.abs(n) < 1e-12 ? 0 : Math.abs(n - 1) < 1e-12 ? 1 : Math.abs(n + 1) < 1e-12 ? -1 : n);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ].map(snap);
}

export function rotate(m: number[], p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}

/** a · b for two row-major 3×3 matrices. */
export function matMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return out;
}

export function transpose(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Euler degrees [rx, ry, rz] (applied X, then Y, then Z) of a rotation matrix. */
export function eulerFromMatrix(m: number[]): Vec3 {
  const sy = Math.max(-1, Math.min(1, -m[6]));
  const ry = Math.asin(sy);
  let rx: number;
  let rz: number;
  if (Math.abs(Math.cos(ry)) > 1e-6) {
    rx = Math.atan2(m[7], m[8]);
    rz = Math.atan2(m[3], m[0]);
  } else {
    rx = Math.atan2(-m[5], m[4]);
    rz = 0;
  }
  const deg = (a: number) => r3((a * 180) / Math.PI);
  return [deg(rx), deg(ry), deg(rz)];
}

export type Box3 = { min: Vec3; max: Vec3 };

/** The axis-aligned box of a local box [min, max] after rotation `m` and translation `t`. */
export function transformBox(b: Box3, m: number[], t: Vec3): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p: Vec3 = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
    const q = v3.add(rotate(m, p), t);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], q[k]);
      max[k] = Math.max(max[k], q[k]);
    }
  }
  return { min: r3v(min), max: r3v(max) };
}

/** Overlap depth of two boxes per axis (negative = gap). */
export function boxOverlap(a: Box3, b: Box3): Vec3 {
  return [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k])) as Vec3;
}

/** Smallest distance between two boxes (0 when they touch or overlap). */
export function boxGap(a: Box3, b: Box3): number {
  const o = boxOverlap(a, b);
  const g = o.map((x) => Math.max(0, -x));
  return Math.hypot(g[0], g[1], g[2]);
}

// ---------------------------------------------------------------------------
// 2D outlines (counter-clockwise, centred on the origin)
// ---------------------------------------------------------------------------

/** Points per 90° of a rounded corner (smooth at print scale). */
export const CORNER_STEPS = 10;

export function rrectOutline(w: number, d: number, r: number, steps = CORNER_STEPS): Vec2[] {
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.max(0, Math.min(r, hw - 1e-3, hd - 1e-3));
  if (rr < 1e-3) return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const out: Vec2[] = [];
  const corners: [number, number, number][] = [
    [hw - rr, -hd + rr, -90],
    [hw - rr, hd - rr, 0],
    [-hw + rr, hd - rr, 90],
    [-hw + rr, -hd + rr, 180],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (90 * i) / steps) * Math.PI) / 180;
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

export function ellipseOutline(w: number, d: number, segments = 72): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    out.push([(w / 2) * Math.cos(a), (d / 2) * Math.sin(a)]);
  }
  return out;
}

/** |x/a|^n + |y/b|^n = 1 (n = 2 ellipse, larger = squarer). Convex for n ≥ 2. */
export function superellipseOutline(w: number, d: number, n: number, segments = 72): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([(w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), (d / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lathe profile with rounded corners
// ---------------------------------------------------------------------------

/**
 * The closed half-profile of a lathed part in (r, z): from the axis at the bottom,
 * out along the base, up through the control points (each corner rounded with radius
 * `round`, limited so arcs never overlap), and back to the axis at the top. The bottom
 * outer corner gets at most 1.5 mm (a big round there would be an overhang on the bed).
 */
export function latheOutline(points: readonly (readonly [number, number])[], round: number): Vec2[] {
  const pts: Vec2[] = points.map(([r, z]) => [r, z]);
  const top = pts[pts.length - 1];
  const poly: Vec2[] = [[0, 0], ...pts];
  if (top[0] > 1e-6) poly.push([0, top[1]]);
  const out: Vec2[] = [[0, 0]];
  const last = poly.length - 1;
  for (let i = 1; i < poly.length; i++) {
    const B = poly[i];
    // Corners on the axis (start / end) stay sharp: they are the revolve seam.
    if (i === last || B[0] <= 1e-6) {
      out.push(B);
      continue;
    }
    const A = poly[i - 1];
    const C = poly[i + 1];
    const R = i === 1 ? Math.min(round, 1.5) : round;
    out.push(...filletCorner(A, B, C, R));
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

/** The arc that rounds corner B (between A→B and B→C), as points from A's side to C's. */
export function filletCorner(A: Vec2, B: Vec2, C: Vec2, R: number): Vec2[] {
  const ux = A[0] - B[0], uy = A[1] - B[1];
  const vx = C[0] - B[0], vy = C[1] - B[1];
  const la = Math.hypot(ux, uy);
  const lc = Math.hypot(vx, vy);
  if (la < 1e-6 || lc < 1e-6 || R < 1e-3) return [B];
  const u: Vec2 = [ux / la, uy / la];
  const v: Vec2 = [vx / lc, vy / lc];
  const cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
  const theta = Math.acos(cos); // interior angle at B
  if (theta > Math.PI - 1e-3 || theta < 1e-3) return [B];
  const tanHalf = Math.tan(theta / 2);
  let t = R / tanHalf;
  const tMax = 0.45 * Math.min(la, lc);
  if (t > tMax) t = tMax;
  const rr = t * tanHalf;
  const T1: Vec2 = [B[0] + u[0] * t, B[1] + u[1] * t];
  const T2: Vec2 = [B[0] + v[0] * t, B[1] + v[1] * t];
  const bis: Vec2 = [u[0] + v[0], u[1] + v[1]];
  const bl = Math.hypot(bis[0], bis[1]);
  const dist = rr / Math.sin(theta / 2);
  const O: Vec2 = [B[0] + (bis[0] / bl) * dist, B[1] + (bis[1] / bl) * dist];
  const a1 = Math.atan2(T1[1] - O[1], T1[0] - O[0]);
  let a2 = Math.atan2(T2[1] - O[1], T2[0] - O[0]);
  // Go the short way round.
  let da = a2 - a1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  a2 = a1 + da;
  const steps = Math.max(3, Math.ceil(Math.abs(da) / (Math.PI / 16)));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (da * i) / steps;
    out.push([O[0] + rr * Math.cos(a), O[1] + rr * Math.sin(a)]);
  }
  return out;
}

/** Largest radius of an (r, z) outline at height z (0 when z is outside it). */
export function outlineRadiusAt(outline: readonly Vec2[], z: number): number {
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const [r0, z0] = outline[i];
    const [r1, z1] = outline[(i + 1) % outline.length];
    const lo = Math.min(z0, z1);
    const hi = Math.max(z0, z1);
    if (z < lo - 1e-9 || z > hi + 1e-9) continue;
    const r = Math.abs(z1 - z0) < 1e-9 ? Math.max(r0, r1) : r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
    best = Math.max(best, r);
  }
  return best;
}

/** Highest z of an (r, z) outline at radius r (the top surface there), or 0. */
export function outlineTopAt(outline: readonly Vec2[], r: number): number {
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const [r0, z0] = outline[i];
    const [r1, z1] = outline[(i + 1) % outline.length];
    const lo = Math.min(r0, r1);
    const hi = Math.max(r0, r1);
    if (r < lo - 1e-9 || r > hi + 1e-9) continue;
    const z = Math.abs(r1 - r0) < 1e-9 ? Math.max(z0, z1) : z0 + ((r - r0) / (r1 - r0)) * (z1 - z0);
    best = Math.max(best, z);
  }
  return best;
}

export function outlineExtent(outline: readonly Vec2[]): { rMax: number; zMax: number; zAtRMax: number } {
  let rMax = 0;
  let zMax = 0;
  let zAtRMax = 0;
  for (const [r, z] of outline) {
    if (r > rMax + 1e-9) {
      rMax = r;
      zAtRMax = z;
    }
    zMax = Math.max(zMax, z);
  }
  return { rMax, zMax, zAtRMax };
}

/**
 * Steepest overhang of an (r, z) outline printed upright (degrees from vertical, 0 = a
 * wall, 90 = a flat ceiling). Only the outside surface counts (segments with r growing
 * as z grows face downwards); the bed face and the top are ignored.
 */
export function outlineOverhangDeg(outline: readonly Vec2[], flip = false): number {
  // The outline runs counter-clockwise in (r, z): bottom out, up the outside, top in.
  // A segment (dr, dz) has the outward normal (dz, −dr); printing upside down mirrors z.
  let worst = 0;
  const zMax = outlineExtent(outline).zMax;
  for (let i = 0; i < outline.length; i++) {
    const [r0, z0] = outline[i];
    const [r1, z1] = outline[(i + 1) % outline.length];
    if (r0 < 1e-6 && r1 < 1e-6) continue; // the axis
    const dz = z1 - z0;
    const dr = r1 - r0;
    const len = Math.hypot(dr, dz);
    // Tiny segments (the end of a fillet arc) are bridged by the slicer.
    if (len < 0.6) continue;
    const nz = (flip ? dr : -dr) / len;
    if (nz >= -1e-9) continue; // faces up or sideways
    const zLow = flip ? zMax - Math.max(z0, z1) : Math.min(z0, z1);
    if (Math.abs(dz) < 1e-6 && zLow < 0.3) continue; // the face on the bed
    worst = Math.max(worst, (Math.asin(Math.min(1, -nz)) * 180) / Math.PI);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/** Centripetal-free (uniform) Catmull-Rom through `pts`, `samples` points in all. */
export function catmullRom(pts: readonly Vec3[], samples = 32): Vec3[] {
  if (pts.length < 2) return pts.map((p) => [...p] as Vec3);
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const segs = pts.length - 1;
  const out: Vec3[] = [];
  for (let s = 0; s < samples; s++) {
    const tt = (s / (samples - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(tt));
    const t = tt - i;
    const p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
    const t2 = t * t;
    const t3 = t2 * t;
    out.push([0, 1, 2].map((k) =>
      0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
    ) as Vec3);
  }
  return out;
}

export function polylineLength(pts: readonly Vec3[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += v3.len(v3.sub(pts[i], pts[i - 1]));
  return l;
}

/** A nozzle's centre line in its RAW frame: base at the origin, reaching −y, then bending down. */
export function nozzlePath(length: number, angleDeg: number, drop: number): Vec3[] {
  const a = (angleDeg * Math.PI) / 180;
  const p1: Vec3 = [0, -length, 0];
  const pts: Vec3[] = [[0, 0, 0], p1];
  if (drop > 0.5) pts.push([0, -length - drop * Math.cos(a), -drop * Math.sin(a)]);
  return pts;
}

/** A tube body's centre line in its RAW frame: an arc of `bendDeg` in the x-z plane. */
export function tubeBodyPath(length: number, bendDeg: number, samples = 24): Vec3[] {
  const b = (bendDeg * Math.PI) / 180;
  if (b < 1e-3) return [[0, 0, 0], [length, 0, 0]];
  const R = length / b;
  const out: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (b * i) / (samples - 1);
    out.push([R * Math.sin(t), 0, R * (1 - Math.cos(t))]);
  }
  return out;
}
