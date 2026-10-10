// Deterministic component packing for the Design Studio (units mm, Z up).
//
// Input: the chosen parts. Output: where each part's local origin goes
// (models/types.ts convention: a part spans x ∈ [-dx/2, dx/2], y ∈ [-dy/2, dy/2],
// z ∈ [0, dz]) plus the overall bounding box, centred on the XY origin, z from 0.
//
// Strategy ("frame" packer):
//  * parts with a side port (+x/-x/+y/-y) go into an edge group for that face:
//    -y = front row, +y = back row, -x = left column, +x = right column; every
//    part in a group is aligned flush with its outer edge, so its port touches
//    that face of the bounding box (and later the enclosure wall);
//  * everything else is shelf-packed in the centre; the shelf width is searched
//    so the whole footprint lands near 1.4 : 1 with the least area;
//  * a battery goes UNDER the main board when it fits inside the board footprint
//    (board on standoffs = battery height + 2), else it is packed like any part;
//  * parts with +z ports (screens, buttons, light pipes…) are raised so their top
//    is level with the tallest stack — they sit right under the lid;
//  * gaps are ≥ max(the two parts' clearance, opts.clearance);
//  * helper parts (resistors…) are not placed physically unless they have ports.
//
// Determinism: input order does not matter (parts are sorted by footprint area
// desc, then instanceId), and every decision is a pure function of the input.

import { LIMITS, type Face, type LayoutItem, type LibraryPart, type SizeHint } from "./schema";

export type Vec3 = [number, number, number];
export type RotZ = 0 | 90 | 180 | 270;

export type LayoutInput = { instanceId: string; part: LibraryPart };
export type LayoutOptions = { clearance?: number; sizeHint?: SizeHint };
export type LayoutResult = {
  layout: LayoutItem[];
  bbox: { min: Vec3; max: Vec3 };
  footprint: { w: number; d: number };
  height: number;
};

/** Target footprint aspect (x : y). */
const TARGET_RATIO = 1.4;
/** Gap between a battery and the board stacked on it. */
const STACK_GAP = 2;

const SIDE_ORDER: Face[] = ["+x", "+y", "-x", "-y"]; // counter-clockwise

/** Where a part-local face points after rotating the part by rotZ (CCW, about +z). */
export function rotateFace(face: Face, rotZ: RotZ): Face {
  if (face === "+z") return face;
  const i = SIDE_ORDER.indexOf(face);
  return SIDE_ORDER[(i + rotZ / 90) % 4];
}

const COS: Record<RotZ, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<RotZ, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

/** Rotate a part-local XY vector by rotZ (exact for the 4 right angles). */
export function rotateXY(x: number, y: number, rotZ: RotZ): [number, number] {
  const c = COS[rotZ];
  const s = SIN[rotZ];
  return [x * c - y * s, x * s + y * c];
}

/** Footprint (x, y extents) of a part after rotation. */
export function rotatedSize(part: LibraryPart, rotZ: RotZ): [number, number] {
  return rotZ === 90 || rotZ === 270 ? [part.dims.y, part.dims.x] : [part.dims.x, part.dims.y];
}

/** AABB of a placed part in layout space (rotZ taken into account). */
export function worldBox(item: LayoutItem, part: LibraryPart): { min: Vec3; max: Vec3 } {
  const [w, d] = rotatedSize(part, item.rotZ);
  const [x, y, z] = item.pos;
  return { min: [x - w / 2, y - d / 2, z], max: [x + w / 2, y + d / 2, z + part.dims.z] };
}

export function isBattery(part: LibraryPart): boolean {
  if (part.category !== "power") return false;
  return part.tags.some((t) => t.toLowerCase() === "battery") || /cell|battery|(^|_)aa/.test(part.id);
}

export function hasTopPort(part: LibraryPart): boolean {
  return part.ports.some((p) => p.face === "+z");
}

/** The side port that decides where the part goes (largest opening, then first). */
export function primarySideFace(part: LibraryPart): Face | null {
  let best: { face: Face; area: number } | null = null;
  for (const p of part.ports) {
    if (p.face === "+z") continue;
    const area = p.size.w * p.size.h;
    if (!best || area > best.area) best = { face: p.face, area };
  }
  return best?.face ?? null;
}

// ---------------------------------------------------------------------------
// Blocks: one part, or a battery + board stack.
// ---------------------------------------------------------------------------

type Member = {
  instanceId: string;
  part: LibraryPart;
  rotZ: RotZ;
  /** Centre offset inside the block (from the block's min corner). */
  cx: number;
  cy: number;
  z: number;
};

type Block = {
  key: string;
  members: Member[];
  w: number;
  d: number;
  clearance: number;
  face: Face | null;
  /** Raise to the tallest stack (single part with a +z port). */
  raise: boolean;
};

type Placed = { block: Block; x: number; y: number };

const area = (p: LibraryPart) => p.dims.x * p.dims.y;

function sortParts(items: LayoutInput[]): LayoutInput[] {
  return [...items].sort((a, b) => {
    const da = area(b.part) - area(a.part);
    if (Math.abs(da) > 1e-9) return da;
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  });
}

function singleBlock(it: LayoutInput): Block {
  const face = primarySideFace(it.part);
  // Free parts lie with their long side along x (the long side of the footprint).
  const rotZ: RotZ = face === null && it.part.dims.y > it.part.dims.x + 1e-9 ? 90 : 0;
  const [w, d] = rotatedSize(it.part, rotZ);
  return {
    key: it.instanceId,
    members: [{ instanceId: it.instanceId, part: it.part, rotZ, cx: w / 2, cy: d / 2, z: 0 }],
    w,
    d,
    clearance: it.part.clearance,
    face,
    raise: hasTopPort(it.part),
  };
}

function makeBlocks(items: LayoutInput[]): Block[] {
  const sorted = sortParts(items.filter((it) => !it.part.helper || it.part.ports.length > 0));
  const board = sorted.find((it) => it.part.category === "mcu");
  let stacked: { battery: LayoutInput; rotZ: RotZ } | null = null;
  if (board) {
    const bb = singleBlock(board);
    for (const it of sorted) {
      if (it === board || !isBattery(it.part)) continue;
      const fits = (rot: RotZ) => {
        const [w, d] = rotatedSize(it.part, rot);
        return w <= bb.w + 1e-9 && d <= bb.d + 1e-9;
      };
      const rot: RotZ | null = fits(0) ? 0 : fits(90) ? 90 : null;
      if (rot !== null) {
        stacked = { battery: it, rotZ: rot };
        break;
      }
    }
  }
  const blocks: Block[] = [];
  for (const it of sorted) {
    if (stacked && it === stacked.battery) continue;
    const b = singleBlock(it);
    if (stacked && it === board) {
      const bat = stacked.battery;
      const lift = bat.part.dims.z + STACK_GAP;
      b.members[0].z = lift;
      b.members.unshift({
        instanceId: bat.instanceId,
        part: bat.part,
        rotZ: stacked.rotZ,
        cx: b.w / 2,
        cy: b.d / 2,
        z: 0,
      });
      b.clearance = Math.max(b.clearance, bat.part.clearance);
      b.raise = false;
    }
    blocks.push(b);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

type Group = { placed: Placed[]; w: number; d: number; clearance: number };

const emptyGroup = (): Group => ({ placed: [], w: 0, d: 0, clearance: 0 });

/** Lay blocks in a line along x (row) or y (column). */
function line(blocks: Block[], axis: "x" | "y", minC: number): Group {
  const g = emptyGroup();
  let cursor = 0;
  let prev: Block | null = null;
  for (const b of blocks) {
    if (prev) cursor += Math.max(minC, prev.clearance, b.clearance);
    g.placed.push(axis === "x" ? { block: b, x: cursor, y: 0 } : { block: b, x: 0, y: cursor });
    cursor += axis === "x" ? b.w : b.d;
    g.clearance = Math.max(g.clearance, b.clearance);
    prev = b;
  }
  if (axis === "x") {
    g.w = cursor;
    g.d = Math.max(0, ...blocks.map((b) => b.d));
  } else {
    g.d = cursor;
    g.w = Math.max(0, ...blocks.map((b) => b.w));
  }
  return g;
}

/** Shelf packing (rows along x, stacked along y) with a maximum shelf width. */
function shelves(blocks: Block[], maxW: number, minC: number): Group {
  const rows: Block[][] = [];
  let cur: Block[] = [];
  let curW = 0;
  for (const b of blocks) {
    const prev = cur[cur.length - 1];
    const next = prev ? curW + Math.max(minC, prev.clearance, b.clearance) + b.w : b.w;
    if (prev && next > maxW + 1e-9) {
      rows.push(cur);
      cur = [b];
      curW = b.w;
    } else {
      cur.push(b);
      curW = next;
    }
  }
  if (cur.length) rows.push(cur);
  const g = emptyGroup();
  let y = 0;
  let prevRow: Group | null = null;
  for (const r of rows) {
    const row = line(r, "x", minC);
    if (prevRow) y += Math.max(minC, prevRow.clearance, row.clearance);
    for (const p of row.placed) g.placed.push({ block: p.block, x: p.x, y });
    g.w = Math.max(g.w, row.w);
    y += row.d;
    g.clearance = Math.max(g.clearance, row.clearance);
    prevRow = row;
  }
  g.d = y;
  return g;
}

const gapBetween = (a: Group, b: Group, minC: number) => Math.max(minC, a.clearance, b.clearance);

type Frame = { placed: Placed[]; W: number; D: number };

function assemble(groups: { L: Group; R: Group; F: Group; B: Group; C: Group }, minC: number): Frame {
  const { L, R, F, B, C } = groups;
  const has = (g: Group) => g.placed.length > 0;
  // Middle band: L | C | R.
  const mids = [L, C, R].filter(has);
  let Mw = 0;
  mids.forEach((g, i) => {
    if (i > 0) Mw += gapBetween(mids[i - 1], g, minC);
    Mw += g.w;
  });
  const Mh = Math.max(0, ...mids.map((g) => g.d));
  const W = Math.max(Mw, F.w, B.w);
  const bands = [F, { ...emptyGroup(), placed: mids.flatMap((g) => g.placed), d: Mh, clearance: Math.max(0, ...mids.map((g) => g.clearance)) }, B].filter(has);
  const out: Placed[] = [];
  let y = 0;
  let prevBand: Group | null = null;
  const bandY = new Map<Group, number>();
  for (const band of bands) {
    if (prevBand) y += gapBetween(prevBand, band, minC);
    bandY.set(band, y);
    y += band.d;
    prevBand = band;
  }
  const D = y;
  // Front row: flush with y = 0; back row: flush with y = D.
  if (has(F)) {
    const x0 = (W - F.w) / 2;
    for (const p of F.placed) out.push({ block: p.block, x: x0 + p.x, y: 0 });
  }
  if (has(B)) {
    const x0 = (W - B.w) / 2;
    for (const p of B.placed) out.push({ block: p.block, x: x0 + p.x, y: D - p.block.d });
  }
  if (mids.length) {
    const midY = bandY.get(bands.find((b) => b !== F && b !== B)!)!;
    // Left column flush with x = 0, right column flush with x = W, centre in between.
    const lEnd = has(L) ? L.w + gapBetween(L, C.placed.length ? C : R, minC) : 0;
    const rStart = has(R) ? W - R.w - gapBetween(C.placed.length ? C : L, R, minC) : W;
    for (const p of L.placed) out.push({ block: p.block, x: 0, y: midY + (Mh - L.d) / 2 + p.y });
    for (const p of R.placed) out.push({ block: p.block, x: W - p.block.w, y: midY + (Mh - R.d) / 2 + p.y });
    const cx0 = lEnd + Math.max(0, (rStart - lEnd - C.w) / 2);
    for (const p of C.placed) out.push({ block: p.block, x: cx0 + p.x, y: midY + (Mh - C.d) / 2 + p.y });
  }
  return { placed: out, W, D };
}

export function layoutComponents(items: LayoutInput[], opts: LayoutOptions = {}): LayoutResult {
  const minC = Math.max(0, opts.clearance ?? LIMITS.clearance.min);
  const blocks = makeBlocks(items);
  if (blocks.length === 0) {
    return { layout: [], bbox: { min: [0, 0, 0], max: [0, 0, 0] }, footprint: { w: 0, d: 0 }, height: 0 };
  }
  const by = (f: Face) => blocks.filter((b) => b.face === f);
  const L = line(by("-x"), "y", minC);
  const R = line(by("+x"), "y", minC);
  const F = line(by("-y"), "x", minC);
  const B = line(by("+y"), "x", minC);
  const free = blocks.filter((b) => b.face === null);

  // Search the centre shelf width for the best (compact, ~1.4:1) frame.
  let best: { frame: Frame; score: number } | null = null;
  const maxW = Math.max(0, ...free.map((b) => b.w));
  const sumW = free.reduce((s, b, i) => s + b.w + (i ? Math.max(minC, b.clearance) : 0), 0);
  const steps = free.length > 1 ? 24 : 0;
  for (let k = 0; k <= steps; k++) {
    const target = steps ? maxW + ((sumW - maxW) * k) / steps : maxW;
    const C = shelves(free, target, minC);
    const frame = assemble({ L, R, F, B, C }, minC);
    const ratio = frame.W / Math.max(1e-6, frame.D);
    const score = frame.W * frame.D * (1 + 0.6 * Math.abs(Math.log(ratio / TARGET_RATIO)));
    if (!best || score < best.score - 1e-9) best = { frame, score };
  }
  const { frame } = best!;

  // Heights: tallest stack, then raise +z-port parts to it.
  let top = 0;
  for (const p of frame.placed) for (const m of p.block.members) top = Math.max(top, m.z + m.part.dims.z);
  const layout: LayoutItem[] = [];
  for (const p of frame.placed) {
    for (const m of p.block.members) {
      const z = p.block.raise ? Math.max(0, top - m.part.dims.z) : m.z;
      layout.push({
        instanceId: m.instanceId,
        pos: [round(p.x + m.cx - frame.W / 2), round(p.y + m.cy - frame.D / 2), round(z)],
        rotZ: m.rotZ,
      });
    }
  }
  layout.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

  const partOf = new Map(items.map((it) => [it.instanceId, it.part]));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const it of layout) {
    const box = worldBox(it, partOf.get(it.instanceId)!);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], box.min[i]);
      max[i] = Math.max(max[i], box.max[i]);
    }
  }
  return {
    layout,
    bbox: { min, max },
    footprint: { w: max[0] - min[0], d: max[1] - min[1] },
    height: max[2],
  };
}

/** Round to 1 µm so tiny float noise never changes a result between runs. */
function round(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}
