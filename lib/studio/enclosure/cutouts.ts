// Openings in the enclosure. The AI never places holes: every LibraryPart port
// of a placed part becomes one rounded opening on the matching wall (side ports
// through the side wall, +z ports through the lid top), vents follow the
// EnclosureSpec pattern, and a wall plate gets two keyhole slots in its back.
// Each Cutout describes a prism (centre, axes, size, depth) that build.ts
// subtracts from the shell.

import type { EnclosureSpec, LayoutItem, LibraryPart, PortKind, VentFace } from "../schema";
import { openingSize, rotateFace, rotateXY, type Vec3 } from "../layout";
import { exitDistance, innerTopAt, insideSection, topRange, type EnclosureDims } from "./templates";

export type CutoutShape = "rrect" | "circle" | "hex" | "grille" | "arc" | "keyhole";

export type Cutout = {
  id: string;
  instanceId: string | null;
  portIndex: number | null;
  kind: PortKind | "vent" | "keyhole";
  face: VentFace;
  /** Centre of the cutting prism (enclosure space). */
  center: Vec3;
  /** Face normal (outward) and the two in-plane axes (u = w, v = h). */
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  w: number;
  h: number;
  radius: number;
  /** Prism length along `axis` (defaults to `normal`). */
  depth: number;
  shape: CutoutShape;
  /** Prism direction when it is not the face normal (louvres slant down-outwards). */
  axis?: Vec3;
  /** Outer-edge chamfer (mm) — louvres. */
  bevel?: number;
  /** Where the outer surface is along the prism, from its centre (mm, for the bevel). */
  outerAt?: number;
  /** speaker_grille: small round holes relative to the centre, in (u, v). */
  holes?: { u: number; v: number; d: number }[];
  /** grille vents: one arc slot (circle centre relative to the cutout centre, in (u, v)). */
  arc?: { cu: number; cv: number; r: number; a0: number; a1: number; width: number };
  /** keyhole: head circle (centre at v = headV) and a slot of slotW × slotL running along −v. */
  keyhole?: { headD: number; slotW: number; slotL: number; headV: number };
};

export { PORT_TOLERANCE, openingSize } from "../layout";

type Basis = { n: Vec3; u: Vec3; v: Vec3 };
const BASIS: Record<VentFace, Basis> = {
  "+x": { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  "-x": { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
  "+y": { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
  "-y": { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  "+z": { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  "-z": { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
};
const SIDE_FACES: VentFace[] = ["+x", "-x", "+y", "-y"];
const isSide = (f: VentFace) => SIDE_FACES.includes(f);

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Minimum material between a vent and a port opening / the label (mm). */
export const VENT_MARGIN = 3;
/** Louvre slant (deg, outer end lower) and outer chamfer (mm). */
export const LOUVRE = { tiltDeg: 35, bevel: 0.8, h: 2.2, pitch: 5.5 } as const;
/** Grille arcs: first ring radius, ring pitch, slot width, bridge (mm). */
export const GRILLE = { r0: 4, pitch: 3.4, width: 1.6, bridge: 2.4, arcsPerRing: 3, maxRings: 6 } as const;
/** Keyhole for a screw head ≤ 7 mm. */
export const KEYHOLE = { headD: 7.5, slotW: 3.8, slotL: 7 } as const;

/** Port point on the part face, part-local (part spans ±dx/2, ±dy/2, 0..dz). */
export function portLocal(part: LibraryPart, face: string, u: number, v: number): Vec3 {
  const { x: dx, y: dy, z: dz } = part.dims;
  switch (face) {
    case "+x": return [dx / 2, -dy / 2 + u * dy, v * dz];
    case "-x": return [-dx / 2, dy / 2 - u * dy, v * dz];
    case "+y": return [dx / 2 - u * dx, dy / 2, v * dz];
    case "-y": return [-dx / 2 + u * dx, -dy / 2, v * dz];
    default: return [-dx / 2 + u * dx, -dy / 2 + v * dy, dz];
  }
}

/** Grid of small holes filling a w × h area (speaker grille). */
export function grilleHoles(w: number, h: number, d = 1.6, pitch = 3): { u: number; v: number; d: number }[] {
  const nu = Math.max(1, Math.floor((w - d) / pitch) + 1);
  const nv = Math.max(1, Math.floor((h - d) / pitch) + 1);
  const out: { u: number; v: number; d: number }[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      out.push({ u: (i - (nu - 1) / 2) * pitch, v: (j - (nv - 1) / 2) * pitch, d });
      if (out.length >= 80) return out;
    }
  }
  return out;
}

/** One opening per port of every placed part. */
export function cutoutsFor(layout: LayoutItem[], parts: Map<string, LibraryPart>, dims: EnclosureDims): Cutout[] {
  const out: Cutout[] = [];
  const [ox, oy, oz] = dims.contentOffset;
  const sorted = [...layout].sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  for (const item of sorted) {
    const part = parts.get(item.instanceId);
    if (!part) continue;
    part.ports.forEach((port, idx) => {
      const local = portLocal(part, port.face, port.at.u, port.at.v);
      const [rx, ry] = rotateXY(local[0], local[1], item.rotZ);
      const p: Vec3 = [rx + item.pos[0] + ox, ry + item.pos[1] + oy, local[2] + item.pos[2] + oz];
      const face = rotateFace(port.face, item.rotZ) as VentFace;
      // Round openings: light pipes, button caps and dome-shaped sensor windows (the PIR).
      const { w, h, round } = openingSize(port);
      const radius = round ? w / 2 : Math.min(1.5, h / 2, w / 2);
      let basis = BASIS[face];
      if (face === "+z") {
        // In-plane axes follow the part's rotation so w stays along the part's x.
        const ux = rotateXY(1, 0, item.rotZ);
        const vy = rotateXY(0, 1, item.rotZ);
        basis = { n: [0, 0, 1], u: [ux[0], ux[1], 0], v: [vy[0], vy[1], 0] };
      }
      let t0 = 0.3;
      let t1: number;
      if (face === "+z") {
        const ex = (Math.abs(basis.u[0]) * w + Math.abs(basis.v[0]) * h) / 2;
        const ey = (Math.abs(basis.u[1]) * w + Math.abs(basis.v[1]) * h) / 2;
        const tr = topRange(dims, p[0] - ex, p[0] + ex, p[1] - ey, p[1] + ey);
        const innerLo = Math.min(
          innerTopAt(dims, p[1] - ey, p[0] - ex), innerTopAt(dims, p[1] - ey, p[0] + ex),
          innerTopAt(dims, p[1] + ey, p[0] - ex), innerTopAt(dims, p[1] + ey, p[0] + ex),
        );
        t1 = tr.hi - p[2] + 2;
        // A dome that reaches the lid: start the cut below the lid's inner surface so it opens fully.
        t0 = Math.min(t0, innerLo - 1 - p[2]);
      } else {
        t1 = exitDistance(dims, p[0], p[1], basis.n[0], basis.n[1]) + 2;
      }
      const depth = Math.max(dims.wall + 2, t1 - t0);
      const center = add(p, basis.n, t1 - depth / 2);
      out.push({
        id: `${item.instanceId}:${idx}`,
        instanceId: item.instanceId,
        portIndex: idx,
        kind: port.kind,
        face,
        center,
        normal: basis.n,
        u: basis.u,
        v: basis.v,
        w,
        h,
        radius,
        depth,
        shape: port.kind === "speaker_grille" ? "grille" : round ? "circle" : "rrect",
        ...(port.kind === "speaker_grille" ? { holes: grilleHoles(port.size.w, port.size.h) } : {}),
      });
    });
  }
  return out;
}

/** World AABB of a cut prism (for overlap checks). */
export function cutoutBox(c: Cutout): { min: Vec3; max: Vec3 } {
  const ax = c.axis ?? c.normal;
  // A bevelled prism widens towards its outer end.
  const grow = c.bevel ? 2 * Math.max(0, c.depth / 2 - (c.outerAt ?? 0) + c.bevel) : 0;
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const e = (Math.abs(c.u[i]) * (c.w + grow) + Math.abs(c.v[i]) * (c.h + grow) + Math.abs(ax[i]) * c.depth) / 2;
    min[i] = c.center[i] - e;
    max[i] = c.center[i] + e;
  }
  return { min, max };
}

export function boxesOverlap(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, margin: number): boolean {
  for (let i = 0; i < 3; i++) if (a.max[i] + margin <= b.min[i] || b.max[i] + margin <= a.min[i]) return false;
  return true;
}

/** Positions of `n` elements in a centred grid (rows along v). */
function grid(n: number, ew: number, eh: number, pu: number, pv: number, spanU: number, spanV: number): [number, number][] {
  const perRow = Math.max(1, Math.floor((spanU - ew) / pu) + 1);
  const maxRows = Math.max(1, Math.floor((spanV - eh) / pv) + 1);
  const rows = Math.min(maxRows, Math.ceil(n / perRow));
  const out: [number, number][] = [];
  let left = Math.min(n, perRow * rows);
  for (let r = 0; r < rows; r++) {
    const k = Math.min(perRow, left);
    for (let i = 0; i < k; i++) out.push([(i - (k - 1) / 2) * pu, (r - (rows - 1) / 2) * pv]);
    left -= k;
  }
  return out;
}

type Element = {
  su: number;
  sv: number;
  w: number;
  h: number;
  shape: CutoutShape;
  radius: number;
  arc?: Cutout["arc"];
  louvre?: boolean;
};

/** Concentric arc slots (with bridges so the centre stays attached), centred on the face. */
export function grilleArcs(count: number, spanU: number, spanV: number): Element[] {
  const maxR = Math.min(spanU, spanV) / 2 - GRILLE.width / 2 - 0.5;
  if (maxR < GRILLE.r0) return [];
  const want = Math.max(1, Math.min(GRILLE.maxRings, Math.ceil(count / GRILLE.arcsPerRing)));
  const rings = Math.min(want, Math.floor((maxR - GRILLE.r0) / GRILLE.pitch) + 1);
  const out: Element[] = [];
  const wd = GRILLE.width;
  for (let k = 0; k < rings; k++) {
    const r = GRILLE.r0 + k * GRILLE.pitch;
    const gap = (GRILLE.bridge + wd) / r;
    const span = (2 * Math.PI) / GRILLE.arcsPerRing - gap;
    if (span <= 0.2) continue;
    const off = (k % 2) * (Math.PI / GRILLE.arcsPerRing) + Math.PI / 2;
    for (let j = 0; j < GRILLE.arcsPerRing; j++) {
      const a0 = off + (j * 2 * Math.PI) / GRILLE.arcsPerRing + gap / 2;
      const a1 = a0 + span;
      // Bounding box of the slot (axis arc ± half width).
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let s = 0; s <= 24; s++) {
        const a = a0 + ((a1 - a0) * s) / 24;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        u0 = Math.min(u0, x); u1 = Math.max(u1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y);
      }
      u0 -= wd / 2; u1 += wd / 2; v0 -= wd / 2; v1 += wd / 2;
      const su = (u0 + u1) / 2;
      const sv = (v0 + v1) / 2;
      out.push({
        su, sv, w: u1 - u0, h: v1 - v0, shape: "arc", radius: wd / 2,
        arc: { cu: -su, cv: -sv, r, a0, a1, width: wd },
      });
    }
  }
  return out;
}

function elementsFor(pattern: EnclosureSpec["vents"]["pattern"], count: number, side: boolean, spanU: number, spanV: number): Element[] {
  if (pattern === "grille") return grilleArcs(count, spanU, spanV);
  if (pattern === "louvres" && side) {
    const w = Math.min(spanU * 0.85, 40);
    if (w < 6) return [];
    const rows = Math.min(count, Math.max(0, Math.floor((spanV - LOUVRE.h) / LOUVRE.pitch) + 1));
    const out: Element[] = [];
    for (let r = 0; r < rows; r++) {
      out.push({ su: 0, sv: (r - (rows - 1) / 2) * LOUVRE.pitch, w, h: LOUVRE.h, shape: "rrect", radius: LOUVRE.h / 2, louvre: true });
    }
    return out;
  }
  let ew: number, eh: number, pu: number, pv: number, shape: CutoutShape;
  if (pattern === "slots" || pattern === "louvres") {
    ew = 2.2;
    eh = Math.max(3, Math.min(side ? 14 : 18, spanV * (side ? 0.9 : 0.5)));
    pu = 4.6;
    pv = eh + 3;
    shape = "rrect";
  } else if (pattern === "holes") {
    ew = eh = 3;
    pu = pv = 5;
    shape = "circle";
  } else {
    ew = eh = 4;
    pu = pv = 5.6;
    shape = "hex";
  }
  return grid(count, ew, eh, pu, pv, spanU, spanV).map(([su, sv]) => ({ su, sv, w: ew, h: eh, shape, radius: ew / 2 }));
}

/** The vent area of one face: spans along u / v and the centre height of a side band. */
function faceArea(dims: EnclosureDims, face: VentFace): { spanU: number; spanV: number; zc: number } {
  const R = dims.shape === "rrect" ? dims.cornerRadius : Math.min(dims.W, dims.D) / 2;
  if (isSide(face)) {
    const along = face === "+x" || face === "-x" ? dims.D : dims.W;
    const spanU = Math.max(4, along - 2 * R - 6);
    let zLo: number;
    let zHi: number;
    if (dims.template === "lantern") {
      // Light slots around the upper band (the lid); the label sits under them.
      zLo = dims.splitZ + (dims.H - dims.splitZ) * 0.4;
      zHi = dims.H - Math.max(dims.edgeFillet, dims.wall) - 3;
    } else {
      zLo = dims.floorZ + 3;
      zHi = dims.splitZ - 3;
      if (zHi - zLo < 4) {
        zLo = dims.floorZ + 1.5;
        zHi = Math.max(zLo + 3, (dims.frontH ?? dims.dome?.z0 ?? dims.H) - dims.wall - 1.5);
      }
    }
    return { spanU, spanV: Math.max(3, zHi - zLo), zc: (zLo + zHi) / 2 };
  }
  if (dims.shape === "circle") {
    // Round top / bottom: a centred square of half the diameter (on a dome: its gentle top).
    const s = Math.max(4, 0.5 * dims.W);
    return { spanU: s, spanV: s, zc: 0 };
  }
  return { spanU: Math.max(4, (dims.W - 2 * R) * 0.8), spanV: Math.max(4, (dims.D - 2 * R) * 0.8), zc: 0 };
}

function ventOnFace(e: Element, face: VentFace, dims: EnclosureDims, zc: number, id: string): Cutout {
  const basis = BASIS[face];
  let center: Vec3;
  let depth: number;
  let axis: Vec3 | undefined;
  let outerAt: number | undefined;
  if (isSide(face)) {
    const sx = basis.u[0] * e.su;
    const sy = basis.u[1] * e.su;
    const tExit = exitDistance(dims, sx, sy, basis.n[0], basis.n[1]);
    const t0 = Math.max(0, tExit - dims.wall - 1.5);
    const t1 = tExit + 2;
    if (e.louvre) {
      // Slanted slat: the passage falls towards the outside (rain sheds), centred mid-wall.
      const tilt = (LOUVRE.tiltDeg * Math.PI) / 180;
      const c = Math.cos(tilt);
      const s = Math.sin(tilt);
      axis = [basis.n[0] * c - basis.v[0] * s, basis.n[1] * c - basis.v[1] * s, basis.n[2] * c - basis.v[2] * s];
      const L = (t1 - t0) / c;
      const tm = tExit - dims.wall / 2;
      const mid: Vec3 = [sx + basis.n[0] * tm, sy + basis.n[1] * tm, zc + e.sv];
      const start = add(mid, axis, -(tm - t0) / c);
      center = add(start, axis, L / 2);
      depth = L;
      outerAt = (tExit - t0) / c - L / 2;
    } else {
      depth = t1 - t0;
      center = [sx + basis.n[0] * (t0 + depth / 2), sy + basis.n[1] * (t0 + depth / 2), zc + e.sv];
    }
  } else if (face === "+z") {
    const x = basis.u[0] * e.su;
    const y = basis.v[1] * e.sv;
    const x0 = x - e.w / 2, x1 = x + e.w / 2, y0 = y - e.h / 2, y1 = y + e.h / 2;
    const lo = Math.min(innerTopAt(dims, y0, x0), innerTopAt(dims, y0, x1), innerTopAt(dims, y1, x0), innerTopAt(dims, y1, x1)) - 1.5;
    const hi = topRange(dims, x0, x1, y0, y1).hi + 2;
    depth = hi - lo;
    center = [x, y, lo + depth / 2];
  } else {
    const x = basis.u[0] * e.su;
    const y = basis.v[1] * e.sv;
    const lo = -2;
    const hi = dims.floorZ + 1.5;
    depth = hi - lo;
    center = [x, y, lo + depth / 2];
  }
  return {
    id,
    instanceId: null,
    portIndex: null,
    kind: "vent",
    face,
    center,
    normal: basis.n,
    u: basis.u,
    v: basis.v,
    w: e.w,
    h: e.h,
    radius: e.radius,
    depth,
    shape: e.shape,
    ...(axis ? { axis, bevel: LOUVRE.bevel, outerAt } : {}),
    ...(e.arc ? { arc: e.arc } : {}),
  };
}

/**
 * Vent openings for spec.vents. A lantern repeats a side pattern on all four sides of its
 * upper band. Louvres only go on side faces (else slots). Any vent within VENT_MARGIN of a
 * port opening, a keyhole or the label (`keepOut`) is left out.
 */
export function ventCutouts(
  spec: EnclosureSpec, dims: EnclosureDims, avoid: Cutout[] = [], keepOut: { min: Vec3; max: Vec3 }[] = [],
): Cutout[] {
  const { face, count } = spec.vents;
  let pattern = spec.vents.pattern;
  if (pattern === "none" || count <= 0) return [];
  if (pattern === "louvres" && !isSide(face)) pattern = "slots";
  const faces: VentFace[] = dims.template === "lantern" && isSide(face) ? SIDE_FACES : [face];
  const blocks = [...avoid.map(cutoutBox), ...keepOut];
  const out: Cutout[] = [];
  // Around a lantern the count is shared out (half per side keeps the band airy and the CSG quick).
  const perFace = faces.length > 1 ? Math.max(2, Math.ceil(count / 2)) : count;
  let n = 0;
  for (const f of faces) {
    const { spanU, spanV, zc } = faceArea(dims, f);
    for (const e of elementsFor(pattern, perFace, isSide(f), spanU, spanV)) {
      const c = ventOnFace(e, f, dims, zc, `vent:${n++}`);
      const box = cutoutBox(c);
      if (blocks.some((b) => boxesOverlap(box, b, VENT_MARGIN))) continue;
      out.push(c);
    }
  }
  return out;
}

/** wall_plate: two keyhole slots through the back (-z), near the top (+y) edge, for wall screws. */
export function keyholeCutouts(dims: EnclosureDims): Cutout[] {
  if (dims.template !== "wall_plate") return [];
  const basis = BASIS["-z"];
  const k = KEYHOLE;
  const edge = dims.wall + 2;
  // Head circle centre: slot (towards +y) ends ≥ edge from the outline.
  const yc = Math.min(dims.D * 0.18, dims.D / 2 - edge - k.slotL - k.slotW / 2);
  let xk = Math.min(dims.W * 0.3, dims.W / 2 - dims.cornerRadius - k.headD / 2 - 2);
  const fits = (x: number) =>
    [[x - k.headD / 2, yc - k.headD / 2], [x + k.headD / 2, yc - k.headD / 2], [x - k.slotW / 2, yc + k.slotL + k.slotW / 2], [x + k.slotW / 2, yc + k.slotL + k.slotW / 2]]
      .every(([px, py]) => insideSection(dims, px, py, edge));
  while (xk > k.headD && !fits(xk)) xk -= 1;
  if (!fits(xk)) return [];
  const lo = -2;
  const hi = dims.floorZ + 1;
  const depth = hi - lo;
  return [-xk, xk].map((x, i) => {
    // Box centre in (u, v): the slot runs along −v (= +y), so the box is shifted that way.
    const vTop = -(yc + k.slotL + k.slotW / 2); // v = −y
    const vBot = -(yc - k.headD / 2);
    const h = vBot - vTop;
    const cy = -((vTop + vBot) / 2);
    return {
      id: `keyhole:${i}`,
      instanceId: null,
      portIndex: null,
      kind: "keyhole" as const,
      face: "-z" as const,
      center: [x, cy, lo + depth / 2] as Vec3,
      normal: basis.n,
      u: basis.u,
      v: basis.v,
      w: k.headD,
      h,
      radius: k.slotW / 2,
      depth,
      shape: "keyhole" as const,
      keyhole: { headD: k.headD, slotW: k.slotW, slotL: k.slotL, headV: cy - yc },
    };
  });
}
