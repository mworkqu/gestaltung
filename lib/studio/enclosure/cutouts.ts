// Openings in the enclosure. The AI never places holes: every LibraryPart port
// of a placed part becomes one rounded opening on the matching wall (side ports
// through the side wall, +z ports through the lid top), and vents follow the
// EnclosureSpec pattern. Each Cutout describes a prism (centre, axes, size,
// depth) that build.ts subtracts from the shell.

import type { EnclosureSpec, LayoutItem, LibraryPart, PortKind, VentFace } from "../schema";
import { isRoundSensorPort, rotateFace, rotateXY, type Vec3 } from "../layout";
import { exitDistance, topAt, type EnclosureDims } from "./templates";

export type CutoutShape = "rrect" | "circle" | "hex" | "grille";

export type Cutout = {
  id: string;
  instanceId: string | null;
  portIndex: number | null;
  kind: PortKind | "vent";
  face: VentFace;
  /** Centre of the cutting prism (enclosure space). */
  center: Vec3;
  /** Prism axis (outward) and the two in-plane axes (u = w, v = h). */
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  w: number;
  h: number;
  radius: number;
  /** Prism length along `normal`. */
  depth: number;
  shape: CutoutShape;
  /** speaker_grille: small round holes relative to the centre, in (u, v). */
  holes?: { u: number; v: number; d: number }[];
};

/** Fit tolerance added to every port opening (mm). */
export const PORT_TOLERANCE = 0.6;

type Basis = { n: Vec3; u: Vec3; v: Vec3 };
const BASIS: Record<VentFace, Basis> = {
  "+x": { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  "-x": { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
  "+y": { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
  "-y": { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  "+z": { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  "-z": { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
};

const ROUND_KINDS: PortKind[] = ["led_light_pipe", "button_cap"];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

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
      const round = ROUND_KINDS.includes(port.kind) || isRoundSensorPort(port);
      let w = port.size.w + PORT_TOLERANCE;
      let h = port.size.h + PORT_TOLERANCE;
      if (round) w = h = Math.max(w, h);
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
        const reach = (Math.abs(basis.u[1]) * w + Math.abs(basis.v[1]) * h) / 2;
        const lo = Math.min(topAt(dims, p[1] - reach), topAt(dims, p[1] + reach));
        t1 = Math.max(topAt(dims, p[1] - reach), topAt(dims, p[1] + reach)) - p[2] + 2;
        // A dome that reaches the lid: start the cut below the lid's inner surface so it opens fully.
        t0 = Math.min(t0, lo - dims.wall - 1 - p[2]);
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
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const e = (Math.abs(c.u[i]) * c.w + Math.abs(c.v[i]) * c.h + Math.abs(c.normal[i]) * c.depth) / 2;
    min[i] = c.center[i] - e;
    max[i] = c.center[i] + e;
  }
  return { min, max };
}

function overlaps(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, margin: number): boolean {
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

/** Vent openings for spec.vents, skipping any that would hit a port opening. */
export function ventCutouts(spec: EnclosureSpec, dims: EnclosureDims, avoid: Cutout[] = []): Cutout[] {
  const { pattern, face, count } = spec.vents;
  if (pattern === "none" || count <= 0) return [];
  const basis = BASIS[face];
  const side = face !== "+z" && face !== "-z";
  const R = dims.shape === "rrect" ? dims.cornerRadius : Math.min(dims.W, dims.D) / 2;
  let spanU: number;
  let spanV: number;
  let zc = 0;
  if (side) {
    const along = face === "+x" || face === "-x" ? dims.D : dims.W;
    spanU = Math.max(4, along - 2 * R - 6);
    let zLo = dims.floorZ + 3;
    let zHi = dims.splitZ - 3;
    if (zHi - zLo < 4) {
      zLo = dims.floorZ + 1.5;
      zHi = Math.max(zLo + 3, (dims.frontH ?? dims.H) - dims.wall - 1.5);
    }
    spanV = zHi - zLo;
    zc = (zLo + zHi) / 2;
  } else {
    spanU = Math.max(4, (dims.W - 2 * R) * 0.8);
    spanV = Math.max(4, (dims.D - 2 * R) * 0.8);
  }
  let ew: number;
  let eh: number;
  let pu: number;
  let pv: number;
  let shape: CutoutShape;
  if (pattern === "slots") {
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
  const spots = grid(count, ew, eh, pu, pv, spanU, spanV);
  const out: Cutout[] = [];
  const avoidBoxes = avoid.map(cutoutBox);
  spots.forEach(([su, sv], i) => {
    let center: Vec3;
    let depth: number;
    if (side) {
      const sx = basis.u[0] * su;
      const sy = basis.u[1] * su;
      const z = zc + sv;
      const tExit = exitDistance(dims, sx, sy, basis.n[0], basis.n[1]);
      const t0 = Math.max(0, tExit - dims.wall - 1.5);
      const t1 = tExit + 2;
      depth = t1 - t0;
      center = [sx + basis.n[0] * (t0 + depth / 2), sy + basis.n[1] * (t0 + depth / 2), z];
    } else if (face === "+z") {
      const x = basis.u[0] * su;
      const y = basis.v[1] * sv;
      const lo = topAt(dims, y) - dims.wall - 1.5;
      const hi = Math.max(topAt(dims, y - eh / 2), topAt(dims, y + eh / 2)) + 2;
      depth = hi - lo;
      center = [x, y, lo + depth / 2];
    } else {
      const x = basis.u[0] * su;
      const y = basis.v[1] * sv;
      const lo = -2;
      const hi = dims.floorZ + 1.5;
      depth = hi - lo;
      center = [x, y, lo + depth / 2];
    }
    const c: Cutout = {
      id: `vent:${i}`,
      instanceId: null,
      portIndex: null,
      kind: "vent",
      face,
      center,
      normal: basis.n,
      u: basis.u,
      v: basis.v,
      w: ew,
      h: eh,
      radius: shape === "rrect" ? ew / 2 : ew / 2,
      depth,
      shape,
    };
    const box = cutoutBox(c);
    if (avoidBoxes.some((b) => overlaps(box, b, 1.5))) return;
    out.push(c);
  });
  return out;
}
