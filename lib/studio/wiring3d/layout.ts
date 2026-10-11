// 3D wiring (P5-17): where each part lies on the mat.
//
// Pure and deterministic. The board (the MCU, else the biggest part) sits at
// the centre; every other part goes on the side of the board its wires come
// from (signals weigh more than ground / power, which every board has on
// several sides), turned in 90° steps so its pins face the board, then pushed
// outward until nothing overlaps. A series helper (a resistor folded into a
// connection as `viaPart`) stands on a small breadboard strip.
//
// Frame: mat plane z = 0, mm, Z up (same as the models).

import type { Connection } from "../connections";
import type { LibraryPart } from "../schema";
import { pins3dFor, type Pin3d, type Vec3 } from "./pins3d";

export type Rot = 0 | 90 | 180 | 270;

export type MatItem = { instanceId: string; part: LibraryPart };

export type Placement = {
  instanceId: string;
  partId: string;
  /** Part origin on the mat (centre of its footprint, z = the surface it stands on). */
  pos: Vec3;
  rotZ: Rot;
  /** Rotated footprint (mm). */
  w: number;
  d: number;
  h: number;
  board: boolean;
  /** Stands on a breadboard strip (series helpers). */
  breadboard: boolean;
};

export type MatLayout = {
  placements: Placement[];
  /** Footprint bounds of everything (incl. breadboard strips), mm. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; maxZ: number };
};

/** Gap between parts (mm). */
export const GAP = 14;
/** Breadboard strip: height and the margin around the helper's legs. */
export const BREADBOARD_H = 5;
export const BREADBOARD_PAD = 6;
/** Helper legs sink this far into the strip. */
const LEG_SINK = 1.2;

type Side = "right" | "bottom" | "left" | "top";
const SIDES: Side[] = ["right", "bottom", "left", "top"];
const SIDE_VEC: Record<Side, [number, number]> = { right: [1, 0], left: [-1, 0], top: [0, 1], bottom: [0, -1] };

/** Rotate a local XY point by rotZ (degrees, CCW). */
export function rotXY(x: number, y: number, rot: Rot): [number, number] {
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

/** A pin of a placed part in mat coordinates (plus a lift for "Take it apart"). */
export function pinWorld(pl: Placement, pin: Pin3d, lift = 0): Pin3d {
  const [x, y] = rotXY(pin.pos[0], pin.pos[1], pl.rotZ);
  const [dx, dy] = rotXY(pin.dir[0], pin.dir[1], pl.rotZ);
  return {
    pos: [pl.pos[0] + x, pl.pos[1] + y, pl.pos[2] + pin.pos[2] + lift],
    dir: [dx, dy, pin.dir[2]],
  };
}

function footprint(part: LibraryPart, rot: Rot, breadboard: boolean) {
  const swap = rot === 90 || rot === 270;
  let w = swap ? part.dims.y : part.dims.x;
  let d = swap ? part.dims.x : part.dims.y;
  let h = part.dims.z;
  if (breadboard) {
    w += BREADBOARD_PAD * 2;
    d += BREADBOARD_PAD * 2;
    h += BREADBOARD_H - LEG_SINK;
  }
  return { w, d, h };
}

/** Breadboard strip size (centred on the helper), mm. */
export function breadboardSize(pl: Placement): { w: number; d: number; h: number } {
  return { w: pl.w, d: pl.d, h: BREADBOARD_H };
}

type Link = { other: string; mine?: string; theirs?: string; weight: number };

/** Who is wired to whom (via helpers count both ways). */
function linksOf(connections: Connection[]): Map<string, Link[]> {
  const m = new Map<string, Link[]>();
  const add = (a: string, l: Link) => m.set(a, [...(m.get(a) ?? []), l]);
  for (const c of connections) {
    const w = c.role === "ground" || c.role === "power" ? 0.5 : 2;
    if (c.viaPart) {
      add(c.from.part, { other: c.viaPart, mine: c.from.pin, weight: w });
      add(c.viaPart, { other: c.from.part, theirs: c.from.pin, weight: w });
      add(c.viaPart, { other: c.to.part, theirs: c.to.pin, weight: w / 2 });
      add(c.to.part, { other: c.viaPart, mine: c.to.pin, weight: w / 2 });
      // The host also leans toward the board pin that drives it.
      add(c.to.part, { other: c.from.part, mine: c.to.pin, theirs: c.from.pin, weight: w });
    } else {
      add(c.from.part, { other: c.to.part, mine: c.from.pin, theirs: c.to.pin, weight: w });
      add(c.to.part, { other: c.from.part, mine: c.to.pin, theirs: c.from.pin, weight: w });
    }
  }
  return m;
}

const overlaps = (a: Placement, b: Placement, gap: number) =>
  Math.abs(a.pos[0] - b.pos[0]) * 2 < a.w + b.w + gap * 2 && Math.abs(a.pos[1] - b.pos[1]) * 2 < a.d + b.d + gap * 2;

/** Lay the circuit's parts out on the mat. Same input → same output. */
export function layoutMat(items: MatItem[], connections: Connection[]): MatLayout {
  if (items.length === 0) return { placements: [], bounds: { minX: -40, maxX: 40, minY: -30, maxY: 30, maxZ: 10 } };
  const area = (p: LibraryPart) => p.dims.x * p.dims.y;
  const board =
    items.find((i) => i.part.category === "mcu") ??
    [...items].sort((a, b) => area(b.part) - area(a.part) || a.instanceId.localeCompare(b.instanceId))[0];
  const helpers = new Set(connections.map((c) => c.viaPart).filter((x): x is string => !!x));
  const links = linksOf(connections);
  const boardPins = pins3dFor(board.part);
  const bHalfX = board.part.dims.x / 2;
  const bHalfY = board.part.dims.y / 2;

  const bp: Placement = {
    instanceId: board.instanceId,
    partId: board.part.id,
    pos: [0, 0, 0],
    rotZ: 0,
    ...footprint(board.part, 0, false),
    board: true,
    breadboard: false,
  };

  // Side + facing for every other part.
  type Draft = { item: MatItem; side: Side; key: number; v: [number, number]; rot: Rot; breadboard: boolean; order: number };
  const sideCount: Record<Side, number> = { right: 0, bottom: 0, left: 0, top: 0 };
  const drafts: Draft[] = [];
  const others = items.filter((i) => i !== board);
  // Directly wired to the board first, so the rest can follow their neighbours' sides.
  const sideOf = new Map<string, [number, number]>();
  const pass = (it: MatItem): [number, number] | null => {
    let sx = 0;
    let sy = 0;
    let wsum = 0;
    for (const l of links.get(it.instanceId) ?? []) {
      let p: [number, number] | null = null;
      if (l.other === board.instanceId && l.theirs && boardPins[l.theirs]) {
        const q = boardPins[l.theirs].pos;
        p = [q[0] / bHalfX, q[1] / bHalfY];
      } else if (sideOf.has(l.other)) p = sideOf.get(l.other)!;
      if (!p) continue;
      sx += p[0] * l.weight;
      sy += p[1] * l.weight;
      wsum += l.weight;
    }
    return wsum > 0 ? [sx / wsum, sy / wsum] : null;
  };
  const ordered = [
    ...others.filter((o) => (links.get(o.instanceId) ?? []).some((l) => l.other === board.instanceId)),
    ...others.filter((o) => !(links.get(o.instanceId) ?? []).some((l) => l.other === board.instanceId)),
  ];
  const keyFor = (side: Side, v: [number, number]) => (side === "left" || side === "right" ? -v[1] : v[0]);
  for (const [order, it] of ordered.entries()) {
    const v = pass(it);
    let side: Side;
    if (v && Math.hypot(v[0], v[1]) > 0.05) {
      side = Math.abs(v[0]) >= Math.abs(v[1]) ? (v[0] >= 0 ? "right" : "left") : v[1] >= 0 ? "top" : "bottom";
    } else {
      side = [...SIDES].sort((a, b) => sideCount[a] - sideCount[b] || SIDES.indexOf(a) - SIDES.indexOf(b))[0];
    }
    sideCount[side]++;
    sideOf.set(it.instanceId, SIDE_VEC[side]);
    const vv = v ?? [0, 0];
    drafts.push({ item: it, side, key: keyFor(side, vv), v: vv, rot: 0, breadboard: helpers.has(it.instanceId), order });
  }

  // A crowded side spills its end parts onto the neighbouring sides (the end they lean to).
  const NEXT: Record<Side, [Side, Side]> = { bottom: ["left", "right"], top: ["left", "right"], left: ["top", "bottom"], right: ["top", "bottom"] };
  const alongLen = (d: Draft) => {
    const f = footprint(d.item.part, 0, d.breadboard);
    return Math.max(f.w, f.d);
  };
  const limit = (side: Side) => Math.max(side === "left" || side === "right" ? board.part.dims.y : board.part.dims.x, 40) + 70;
  for (const side of SIDES) {
    for (let guard = 0; guard < 20; guard++) {
      const row = drafts.filter((d) => d.side === side).sort((a, b) => a.key - b.key || a.order - b.order);
      if (row.length < 2) break;
      const total = row.reduce((t, d) => t + alongLen(d), 0) + GAP * (row.length - 1);
      if (total <= limit(side)) break;
      const first = row[0];
      const last = row[row.length - 1];
      const mover = Math.abs(first.key) > Math.abs(last.key) ? first : last;
      const to = mover === first ? NEXT[side][0] : NEXT[side][1];
      if (drafts.filter((d) => d.side === to).length >= row.length - 1) break;
      mover.side = to;
      mover.key = keyFor(to, mover.v);
    }
  }

  // Turn each part so its wired pins face the board (their centroid points toward −side).
  for (const d of drafts) {
    const pins = pins3dFor(d.item.part);
    const mine = (links.get(d.item.instanceId) ?? []).map((l) => l.mine).filter((x): x is string => !!x && !!pins[x]);
    if (!mine.length) continue;
    const cx = mine.reduce((t, id) => t + pins[id].pos[0], 0) / mine.length;
    const cy = mine.reduce((t, id) => t + pins[id].pos[1], 0) / mine.length;
    if (Math.hypot(cx, cy) <= 1) continue;
    const want = Math.atan2(-SIDE_VEC[d.side][1], -SIDE_VEC[d.side][0]);
    const have = Math.atan2(cy, cx);
    const deg = (((want - have) * 180) / Math.PI + 720) % 360;
    d.rot = ((Math.round(deg / 90) * 90) % 360) as Rot;
  }

  const placed: Placement[] = [bp];
  for (const side of SIDES) {
    const row = drafts.filter((d) => d.side === side).sort((a, b) => a.key - b.key || a.order - b.order);
    if (!row.length) continue;
    const fps = row.map((d) => footprint(d.item.part, d.rot, d.breadboard));
    const along = (f: { w: number; d: number }) => (side === "left" || side === "right" ? f.d : f.w);
    const total = fps.reduce((t, f) => t + along(f), 0) + GAP * (fps.length - 1);
    let cursor = -total / 2;
    row.forEach((d, i) => {
      const f = fps[i];
      const a = cursor + along(f) / 2;
      cursor += along(f) + GAP;
      let x: number;
      let y: number;
      if (side === "right") [x, y] = [bHalfX + GAP + f.w / 2, -a];
      else if (side === "left") [x, y] = [-bHalfX - GAP - f.w / 2, -a];
      else if (side === "top") [x, y] = [a, bHalfY + GAP + f.d / 2];
      else [x, y] = [a, -bHalfY - GAP - f.d / 2];
      const p: Placement = {
        instanceId: d.item.instanceId,
        partId: d.item.part.id,
        pos: [x, y, d.breadboard ? BREADBOARD_H - LEG_SINK : 0],
        rotZ: d.rot,
        ...f,
        board: false,
        breadboard: d.breadboard,
      };
      // Push outward until clear of everything already placed.
      const [vx, vy] = SIDE_VEC[side];
      for (let k = 0; k < 400 && placed.some((q) => overlaps(p, q, GAP / 2)); k++) {
        p.pos = [p.pos[0] + vx * 2, p.pos[1] + vy * 2, p.pos[2]];
      }
      placed.push(p);
    });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.pos[0] - p.w / 2);
    maxX = Math.max(maxX, p.pos[0] + p.w / 2);
    minY = Math.min(minY, p.pos[1] - p.d / 2);
    maxY = Math.max(maxY, p.pos[1] + p.d / 2);
    maxZ = Math.max(maxZ, (p.breadboard ? 0 : p.pos[2]) + p.h);
  }
  // Keep the input order for rendering.
  const byId = new Map(placed.map((p) => [p.instanceId, p]));
  return { placements: items.map((i) => byId.get(i.instanceId)!).filter(Boolean), bounds: { minX, maxX, minY, maxY, maxZ } };
}

/** "Take it apart": how high each part rises (board stays down). */
export function apartLift(layout: MatLayout): Map<string, number> {
  const m = new Map<string, number>();
  let k = 0;
  for (const p of layout.placements) {
    if (p.board) m.set(p.instanceId, 0);
    else m.set(p.instanceId, 34 + 10 * (k++ % 3));
  }
  return m;
}
