// 3D wiring (P5-17e): the solderless breadboard the circuit is built on.
//
// Pure and deterministic (no three.js). The 3D tab shows the circuit the way
// people actually prototype it: small through-hole parts plug INTO the
// breadboard, the main board sits on the mat beside it, power and ground run
// along the rails, and short jumpers link the board pins to the part columns.
//
// Breadboard frame: mm, centred on its own origin, Z up, top face at z = BB_H.
//   columns 0 … cols−1 along X (2.54 mm pitch),
//   terminal rows 0 … 9 = a … j along Y (a … e below the centre channel,
//   f … j above it); the five holes of one column on one side of the channel
//   are ONE electrical group;
//   rails: row 10 = bottom − (blue), 11 = bottom + (red), 12 = top −, 13 = top +;
//   every hole of one rail row is one group (holes in blocks of five).
// Half-size (30 columns, 300 + 100 points) by default; full-size (63 columns)
// when the plugged parts need more room.
//
// Plug rules (one per kind, picked from the model builder):
//   resistor   leads 4 columns apart in row c;
//   led        two legs in neighbouring columns of row e;
//   button     6 mm tactile switch across the centre channel (one switch side
//              in two bottom columns, the other side in the same two top columns);
//   stand      DHT22-style sensor standing up, its 4 pins in a row (row d);
//   module     a small module with ONE male header row (row b, body over the
//              board), or two rows that straddle the channel (DRV8833-style).
// Boards (MCUs), power parts, big or odd parts (pump, servo, battery holder,
// driver with screw terminals, relay, probes) stay on the mat.

import type { LibraryPart } from "../schema";
import { pins3dFor, slotRows, PITCH, type Vec3 } from "./pins3d";
import { round2 } from "@/lib/format/money";

export type Rot = 0 | 90 | 180 | 270;

export const BB_H = 8.5;
export const BB_D = 54.5;
export const HALF_COLS = 30;
export const FULL_COLS = 63;
const END_PAD = 3.3;
/** A jumper's end sinks this far into its hole. */
export const HOLE_SINK = 0.6;

export const RAIL = { bottomMinus: 10, bottomPlus: 11, topMinus: 12, topPlus: 13 } as const;
export const ROW_LETTERS = "abcdefghij";

export type Hole = { col: number; row: number };
export type BreadboardSpec = {
  cols: number;
  /** Centre on the mat (x, y), mm. */
  pos: [number, number];
  w: number;
  d: number;
  h: number;
};

export function breadboardSpec(cols: number, pos: [number, number] = [0, 0]): BreadboardSpec {
  return { cols, pos, w: cols * PITCH + END_PAD * 2, d: BB_D, h: BB_H };
}

/** Local X of a column (breadboard frame). */
export const colX = (cols: number, col: number) => (col - (cols - 1) / 2) * PITCH;

/** Local Y of a row (terminal rows 0–9, rails 10–13). */
export function rowY(row: number): number {
  if (row < 5) return -(3.81 + (4 - row) * PITCH);
  if (row < 10) return 3.81 + (row - 5) * PITCH;
  switch (row) {
    case RAIL.bottomMinus:
      return -20.32;
    case RAIL.bottomPlus:
      return -22.86;
    case RAIL.topMinus:
      return 20.32;
    default:
      return 22.86;
  }
}

export const isRailRow = (row: number) => row >= 10;
/** Rails have holes in blocks of five (every sixth column is a gap). */
export const isRailCol = (col: number) => col % 6 !== 5;

/** Where a jumper end goes into a hole on the mat (z just below the top face). */
export function holeWorld(spec: BreadboardSpec, h: Hole): Vec3 {
  return [spec.pos[0] + colX(spec.cols, h.col), spec.pos[1] + rowY(h.row), spec.h - HOLE_SINK];
}

/** Electrical group of a hole: one column on one side of the channel, or a whole rail. */
export function groupOf(h: Hole): string {
  if (isRailRow(h.row)) return `rail${h.row}`;
  return `col${h.col}${h.row < 5 ? "L" : "U"}`;
}

/** Every hole of the board (for the model and tests). */
export function allHoles(cols: number): Hole[] {
  const out: Hole[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < 10; row++) out.push({ col, row });
    if (isRailCol(col)) for (const row of [10, 11, 12, 13]) out.push({ col, row });
  }
  return out;
}

/** Terminal holes of one group, in the order jumpers take them (outermost row first). */
export function groupHoles(col: number, upper: boolean): Hole[] {
  return (upper ? [9, 8, 7, 6, 5] : [0, 1, 2, 3, 4]).map((row) => ({ col, row }));
}

// ── How a part plugs in ────────────────────────────────────────────────────

export type PlugPin = { id: string; dc: number; row: number };
export type PlugKind = "resistor" | "led" | "button" | "stand" | "module";

/** One way a part sits in the breadboard; columns are relative to an anchor column k. */
export type Plug = {
  kind: PlugKind;
  /** Pin → hole (a pin may take two holes, e.g. a button side). */
  pins: PlugPin[];
  /** Model pose: rotation about Z, a stand-up tilt (about X) and the offset applied after the tilt. */
  rotZ: Rot;
  tilt: 0 | 90;
  offset: Vec3;
  /** Model origin x minus the anchor column's x (mm). */
  cx: number;
  /** Model origin y on the breadboard (local, mm). */
  y: number;
  /** Model base height on the mat (mm). */
  z: number;
  /** Footprint on the board (mm); h = model height above z. */
  w: number;
  d: number;
  h: number;
};

export type PlugSet = { bottom: Plug; top: Plug };

const builderOf = (p: LibraryPart) => (p.model.kind === "procedural" ? p.model.builder : "");

function rotXY(x: number, y: number, rot: Rot): [number, number] {
  switch (rot) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

/** Mirror a plug into the upper half (rows j…f instead of a…e). */
function mirrorTop(p: Plug, turnModel: boolean): Plug {
  if (p.kind === "button") return p;
  const straddle = p.pins.some((q) => q.row >= 5) && p.pins.some((q) => q.row < 5);
  if (straddle) return p;
  const rot = turnModel ? (((p.rotZ + 180) % 360) as Rot) : p.rotZ;
  if (!turnModel) return { ...p, pins: p.pins.map((q) => ({ ...q, row: 9 - q.row })), y: -p.y };
  // Turned model: columns run the other way round the model origin.
  const span = Math.max(...p.pins.map((q) => q.dc));
  const cx = span * PITCH - p.cx;
  return { ...p, rotZ: rot, pins: p.pins.map((q) => ({ ...q, dc: span - q.dc, row: 9 - q.row })), y: -p.y, cx };
}

const ACROSS: [number, number, number][] = [
  [7.62, 4, 5],
  [12.7, 3, 6],
  [17.78, 2, 7],
  [22.86, 1, 8],
];

/**
 * How `part` plugs into the breadboard (bottom-half and top-half versions), or
 * null when it stays on the mat. `first` = the pin to put on the lowest column
 * (resistor / LED), or the switch side to put below the channel (button).
 */
export function plugFor(part: LibraryPart, first?: string): PlugSet | null {
  const b = builderOf(part);
  if (part.category === "mcu") return null;
  const pins = pins3dFor(part);
  const ids = part.pins.map((p) => p.id);
  if (!ids.length) return null;

  if (b === "resistor" && ids.length === 2) {
    const [l, r] = [...ids].sort((a, c) => pins[a].pos[0] - pins[c].pos[0]);
    const flip = first === r;
    const left = flip ? r : l;
    const right = flip ? l : r;
    const p: Plug = {
      kind: "resistor",
      pins: [
        { id: left, dc: 0, row: 2 },
        { id: right, dc: 4, row: 2 },
      ],
      rotZ: flip ? 180 : 0,
      tilt: 0,
      offset: [0, 0, 0],
      cx: 2 * PITCH,
      y: rowY(2),
      z: BB_H - 3,
      w: part.dims.x,
      d: part.dims.y,
      h: part.dims.z,
    };
    return { bottom: p, top: mirrorTop(p, false) };
  }

  if (b === "led" && ids.length === 2) {
    const [l, r] = [...ids].sort((a, c) => pins[a].pos[0] - pins[c].pos[0]);
    const flip = first === r;
    const p: Plug = {
      kind: "led",
      pins: [
        { id: flip ? r : l, dc: 0, row: 4 },
        { id: flip ? l : r, dc: 1, row: 4 },
      ],
      rotZ: flip ? 180 : 0,
      tilt: 0,
      offset: [0, 0, 0],
      cx: PITCH / 2,
      y: rowY(4),
      z: BB_H - 3.5,
      w: part.dims.x,
      d: part.dims.y,
      h: part.dims.z,
    };
    return { bottom: p, top: mirrorTop(p, false) };
  }

  if (b === "pushButton" && ids.length === 2) {
    // Turned 90°: the -x side (A) goes below the channel; 270° puts it above.
    const [l, r] = [...ids].sort((a, c) => pins[a].pos[0] - pins[c].pos[0]);
    const lowFirst = first !== r;
    const below = lowFirst ? l : r;
    const above = lowFirst ? r : l;
    const p: Plug = {
      kind: "button",
      pins: [
        { id: below, dc: 0, row: 4 },
        { id: below, dc: 1, row: 4 },
        { id: above, dc: 0, row: 5 },
        { id: above, dc: 1, row: 5 },
      ],
      rotZ: lowFirst ? 90 : 270,
      tilt: 0,
      offset: [0, 0, 0],
      cx: PITCH / 2,
      y: 0,
      z: BB_H - 2.5,
      w: part.dims.y,
      d: part.dims.x,
      h: part.dims.z,
    };
    return { bottom: p, top: p };
  }

  if (b === "dht22") {
    // Stands up: model -y (pins) turns down (tilt), then 90° about Z so the pins run along X.
    const zc = part.dims.z / 2;
    const slots = ids.map((id) => ({ id, i: Math.round((pins[id].pos[2] - zc) / PITCH + 1.5) }));
    if (slots.some((s) => s.i < 0 || s.i > 3) || new Set(slots.map((s) => s.i)).size !== slots.length) return null;
    const p: Plug = {
      kind: "stand",
      pins: slots.map((s) => ({ id: s.id, dc: s.i, row: 3 })),
      rotZ: 90,
      tilt: 90,
      offset: [0, zc, part.dims.y / 2 - 3],
      cx: 1.5 * PITCH,
      y: rowY(3),
      z: BB_H,
      w: part.dims.z,
      d: part.dims.x,
      h: part.dims.y - 3,
    };
    return { bottom: p, top: mirrorTop(p, false) };
  }

  if (b === "moduleBoard" || b === "oledDisplay") {
    if (part.category === "power") return null;
    if (part.dims.x > 45 || part.dims.y > 35) return null;
    const params = part.model.kind === "procedural" ? part.model.params : {};
    const feats = Array.isArray(params.feats) ? (params.feats as { t?: string }[]) : [];
    if (feats.some((f) => f?.t === "screw")) return null;
    const rows = slotRows(part);
    if (!rows.length || rows.length > 2) return null;
    if (Array.isArray(params.rows) && (params.rows as { kind?: string }[]).some((r) => r?.kind === "socket")) return null;
    // Every pin must sit on a header slot.
    const rowOf = new Map<string, number>();
    for (const id of ids) {
      const q = pins[id].pos;
      const ri = rows.findIndex((r) => r.slots.some((s) => Math.abs(s.pos[0] - q[0]) < 0.01 && Math.abs(s.pos[1] - q[1]) < 0.01));
      if (ri < 0) return null;
      rowOf.set(id, ri);
    }
    const alongX = (r: (typeof rows)[number]) => {
      const xs = r.slots.map((s) => s.pos[0]);
      return r.slots.length < 2 || Math.max(...xs) - Math.min(...xs) > 0.1;
    };
    const axisX = alongX(rows[0]);
    if (rows.length === 2 && alongX(rows[1]) !== axisX) return null;
    let rot: Rot;
    if (rows.length === 1) {
      // Header row along X at the body's -y side.
      if (axisX) rot = rows[0].cy <= 0 ? 0 : 180;
      else rot = rows[0].cx < 0 ? 90 : 270;
    } else rot = axisX ? 0 : 90;
    const rp = (id: string) => rotXY(pins[id].pos[0], pins[id].pos[1], rot);
    const xs = ids.map((id) => rp(id)[0]);
    const minX = Math.min(...xs);
    const dcOf = (id: string) => Math.round((rp(id)[0] - minX) / PITCH);
    const swap = rot === 90 || rot === 270;
    const w = swap ? part.dims.y : part.dims.x;
    const d = swap ? part.dims.x : part.dims.y;
    let out: Plug;
    if (rows.length === 1) {
      const sy = rp(ids[0])[1];
      out = {
        kind: "module",
        pins: ids.map((id) => ({ id, dc: dcOf(id), row: 1 })),
        rotZ: rot,
        tilt: 0,
        offset: [0, 0, 0],
        cx: -minX,
        y: rowY(1) - sy,
        z: BB_H,
        w,
        d,
        h: part.dims.z,
      };
    } else {
      const ys = [...new Set(ids.map((id) => round2(rp(id)[1])))].sort((a, c) => a - c);
      if (ys.length !== 2) return null;
      const pair = ACROSS.find(([s]) => Math.abs(ys[1] - ys[0] - s) < 0.3);
      if (!pair) return null;
      const [, lo, hi] = pair;
      out = {
        kind: "module",
        pins: ids.map((id) => ({ id, dc: dcOf(id), row: round2(rp(id)[1]) === ys[0] ? lo : hi })),
        rotZ: rot,
        tilt: 0,
        offset: [0, 0, 0],
        cx: -minX,
        y: rowY(lo) - ys[0],
        z: BB_H,
        w,
        d,
        h: part.dims.z,
      };
    }
    // Two pins of one part in one group would short them.
    const groups = out.pins.map((q) => `${q.dc}${q.row < 5 ? "L" : "U"}`);
    if (new Set(groups).size !== groups.length) return null;
    return { bottom: out, top: mirrorTop(out, true) };
  }
  return null;
}

/** Absolute holes of a plug anchored at column k. */
export const plugHoles = (p: Plug, k: number): { id: string; col: number; row: number }[] =>
  p.pins.map((q) => ({ id: q.id, col: k + q.dc, row: q.row }));

/** Model origin of a plug anchored at k (mat coordinates). */
export function plugOrigin(spec: BreadboardSpec, p: Plug, k: number): Vec3 {
  return [spec.pos[0] + colX(spec.cols, k) + p.cx, spec.pos[1] + p.y, p.z];
}

/** The anchor column nearest a model origin x on the mat. */
export function anchorNear(spec: BreadboardSpec, p: Plug, x: number): number {
  return Math.round((x - spec.pos[0] - p.cx) / PITCH + (spec.cols - 1) / 2);
}

/** Does the point (model origin, mat mm) lie over the breadboard's terminal strip? */
export function overTerminals(spec: BreadboardSpec, x: number, y: number): boolean {
  return Math.abs(x - spec.pos[0]) <= spec.w / 2 && Math.abs(y - spec.pos[1]) <= 17.5;
}

/** Something already in the board: its pin holes (with nets) and its body rectangle. */
export type Occupant = {
  holes: { col: number; row: number; net: string | null }[];
  rect: { x: number; y: number; w: number; d: number };
};

/**
 * Can `p` go in at anchor k? Every hole on the board, no pin in a group that
 * holds a pin of ANOTHER net (same net is fine: an LED leg in its resistor's
 * column), no two of its own pins on different nets in one group, and its body
 * clear of the other bodies.
 */
export function fits(spec: BreadboardSpec, p: Plug, k: number, netOf: (pin: string) => string | null, others: Occupant[]): boolean {
  const holes = plugHoles(p, k);
  if (holes.some((h) => h.col < 0 || h.col >= spec.cols)) return false;
  const lo = Math.min(...holes.map((h) => h.col));
  const hi = Math.max(...holes.map((h) => h.col));
  if (lo < 0 || hi > spec.cols - 1) return false;
  const used = new Map<string, string | null>();
  for (const o of others) for (const h of o.holes) {
    const g = groupOf(h);
    if (used.has(g) && used.get(g) !== h.net) used.set(g, `!conflict`);
    else used.set(g, h.net);
  }
  const taken = new Set(others.flatMap((o) => o.holes.map((h) => `${h.col}:${h.row}`)));
  const mine = new Map<string, string | null>();
  for (const h of holes) {
    if (taken.has(`${h.col}:${h.row}`)) return false;
    const g = groupOf(h);
    const net = netOf(h.id);
    if (used.has(g)) {
      const there = used.get(g);
      if (!net || there !== net) return false;
    }
    if (mine.has(g) && mine.get(g) !== net) return false;
    mine.set(g, net);
  }
  const o = plugOrigin(spec, p, k);
  // Body must stay over the board.
  if (Math.abs(o[0] - spec.pos[0]) + p.w / 2 > spec.w / 2 + 0.01) return false;
  for (const q of others) {
    if (Math.abs(o[0] - q.rect.x) * 2 < p.w + q.rect.w - 0.02 && Math.abs(o[1] - q.rect.y) * 2 < p.d + q.rect.d - 0.02) return false;
  }
  return true;
}

/** Nearest anchor to `want` (then right before left) where the plug fits, or null. */
export function nearestFit(
  spec: BreadboardSpec,
  p: Plug,
  want: number,
  netOf: (pin: string) => string | null,
  others: Occupant[],
): number | null {
  for (let d = 0; d <= spec.cols; d++) {
    for (const k of d === 0 ? [want] : [want + d, want - d]) {
      if (fits(spec, p, k, netOf, others)) return k;
    }
  }
  return null;
}
