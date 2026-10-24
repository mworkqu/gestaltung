// 3D wiring (P5-17 / P5-17e): where each part sits — on the breadboard or on the mat.
//
// Pure and deterministic. The circuit is laid out the way people prototype it:
//   * a solderless breadboard at the centre of the mat (lib/studio/wiring3d/breadboard.ts),
//     half-size (30 columns) unless the plugged parts need a full-size one (63);
//   * the main board (the MCU, else the biggest part) lies on the mat to the
//     LEFT of the breadboard, turned so its long side runs along the breadboard
//     and its busiest header faces it (one rule for every board: it never
//     straddles the channel, so its pins never share a column with a part);
//   * small through-hole parts plug INTO the breadboard (plugFor): resistors,
//     LEDs, 6 mm buttons across the channel, a DHT22 standing up, small modules
//     by their header. A series resistor goes first and its host's leg goes in
//     the resistor's far column, so they are connected by the breadboard itself.
//     Parts go left to right in build order, one free column between them;
//   * everything else (pump, servo, battery, power boards, relays, probes, big
//     modules) lies on the mat around the board + breadboard, on the side its
//     wires go, turned so its pins face them, pushed out until nothing overlaps;
//   * servos on a servo driver (Part E): the driver lies on the mat above the
//     board + breadboard, its channel headers facing away from them, and its
//     servos stand in one row beyond it in channel order (servo 1 on channel 0
//     at the left), leads facing the driver — 6 to 8 identical servos never
//     pile up around the board.
//
// Moving by hand: a part that can plug in snaps to the nearest free columns
// when dropped over the breadboard (never into a column that holds another
// net); dropped anywhere else it lies on the mat. Other parts never overlap.
//
// Frame: mat plane z = 0, mm, Z up (same as the models).

import type { Connection } from "../connections";
import type { LibraryPart, Net } from "../schema";
import {
  breadboardSpec,
  colX,
  FULL_COLS,
  HALF_COLS,
  holeWorld,
  nearestFit,
  anchorNear,
  overTerminals,
  plugFor,
  plugHoles,
  plugOrigin,
  rowY,
  type BreadboardSpec,
  type Occupant,
  type Plug,
  type PlugSet,
  type Rot,
} from "./breadboard";
import { pins3dFor, type Pin3d, type Vec3 } from "./pins3d";
import { railNets } from "./rails";
import type { MatItem, MatLayout, PlacedHole, Placement } from "./types";

export type { Rot } from "./types";

export type { MatItem, PlacedHole, Placement, MatLayout };

/** Gap between the board / breadboard and a row of mat parts, and between parts in a row (mm): room for a few wire lanes. */
export const GAP = 18;
/** Gap between the board and the breadboard (mm): the board's jumpers cross it side by side. */
export const BOARD_GAP = 16;
/** Minimum clearance kept between any two footprints on the mat by the auto layout (mm). */
export const CLEAR = 14;
/** Grid the wires are routed on (= breadboard pitch); mat parts are placed so a wired pin sits on it. */
const GRID = 2.54;
/** Minimum clearance when the client drags a part (mm). */
export const MOVE_CLEAR = 2;
/** A dragged part stays within this distance of the mat centre (mm). */
export const MAX_REACH = 320;
/** Columns kept free at the left end of the breadboard (feed jumpers land there). */
const FIRST_COL = 1;

type Side = "right" | "bottom" | "left" | "top";
const SIDES: Side[] = ["bottom", "right", "top", "left"];
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

/** Model point → placement frame before rotZ (tilt about X, then the offset). */
function poseLocal(pl: Placement, v: Vec3): Vec3 {
  const t: Vec3 = pl.tilt === 90 ? [v[0], -v[2], v[1]] : v;
  return [t[0] + pl.offset[0], t[1] + pl.offset[1], t[2] + pl.offset[2]];
}

/** A pin of a placed part in mat coordinates (plus a lift for "Take it apart"). */
export function pinWorld(pl: Placement, pin: Pin3d, lift = 0): Pin3d {
  const p = poseLocal(pl, pin.pos);
  const d: Vec3 = pl.tilt === 90 ? [pin.dir[0], -pin.dir[2], pin.dir[1]] : pin.dir;
  const [x, y] = rotXY(p[0], p[1], pl.rotZ);
  const [dx, dy] = rotXY(d[0], d[1], pl.rotZ);
  return {
    pos: [pl.pos[0] + x, pl.pos[1] + y, pl.pos[2] + p[2] + lift],
    dir: [dx, dy, d[2]],
  };
}

function footprint(part: LibraryPart, rot: Rot) {
  const swap = rot === 90 || rot === 270;
  return { w: swap ? part.dims.y : part.dims.x, d: swap ? part.dims.x : part.dims.y, h: part.dims.z };
}

type Link = { other: string; mine?: string; theirs?: string; weight: number; role: Connection["role"]; net: string };

/** Who is wired to whom (via helpers count both ways). */
function linksOf(connections: Connection[]): Map<string, Link[]> {
  const m = new Map<string, Link[]>();
  const add = (a: string, l: Link) => m.set(a, [...(m.get(a) ?? []), l]);
  for (const c of connections) {
    const w = c.role === "ground" || c.role === "power" ? 0.5 : 2;
    const role = c.role;
    const net = c.net;
    if (c.viaPart) {
      add(c.from.part, { other: c.viaPart, mine: c.from.pin, weight: w, role, net });
      add(c.viaPart, { other: c.from.part, theirs: c.from.pin, weight: w, role, net });
      add(c.viaPart, { other: c.to.part, theirs: c.to.pin, weight: w / 2, role, net });
      add(c.to.part, { other: c.viaPart, mine: c.to.pin, weight: w / 2, role, net });
    } else {
      add(c.from.part, { other: c.to.part, mine: c.from.pin, theirs: c.to.pin, weight: w, role, net });
      add(c.to.part, { other: c.from.part, mine: c.to.pin, theirs: c.from.pin, weight: w, role, net });
    }
  }
  return m;
}

type Rect = { x: number; y: number; w: number; d: number };
const rectOf = (p: { pos: Vec3; w: number; d: number }): Rect => ({ x: p.pos[0], y: p.pos[1], w: p.w, d: p.d });
const overlapsR = (a: Rect, b: Rect, gap: number) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.y - b.y) * 2 < a.d + b.d + gap * 2;

/** Net of each "inst.pin" (from the netlist; else from the connections). */
function pinNetMap(connections: Connection[], nets?: Net[]): Map<string, string> {
  const m = new Map<string, string>();
  if (nets?.length) {
    for (const n of nets) for (const r of n.pins) m.set(r, n.name);
    return m;
  }
  for (const c of connections) {
    m.set(`${c.from.part}.${c.from.pin}`, c.net);
    if (!c.viaPart) m.set(`${c.to.part}.${c.to.pin}`, c.net);
  }
  return m;
}

/** The leg of a series helper on the board side of `c`, then the other one. */
function helperLegs(c: Connection, helper: LibraryPart, netOf: Map<string, string>): [string, string] | null {
  if (!c.viaPart || helper.pins.length < 2) return null;
  const near = helper.pins.find((p) => netOf.get(`${c.viaPart}.${p.id}`) === c.net) ?? helper.pins[0];
  const far = helper.pins.find((p) => p.id !== near.id);
  return far ? [near.id, far.id] : null;
}

function occupantOf(spec: BreadboardSpec, pl: Placement): Occupant {
  return {
    holes: (pl.holes ?? []).map((h) => ({ col: h.col, row: h.row, net: pl.pinNets?.[h.id] ?? null })),
    rect: { x: pl.pos[0], y: pl.pos[1], w: pl.w, d: pl.d },
  };
}

/** A plugged pose for `pl` at anchor k. */
function plugged(spec: BreadboardSpec, pl: Placement, plug: Plug, k: number): Placement {
  return {
    ...pl,
    pos: plugOrigin(spec, plug, k),
    rotZ: plug.rotZ,
    tilt: plug.tilt,
    offset: plug.offset,
    w: plug.w,
    d: plug.d,
    h: plug.h,
    holes: plugHoles(plug, k),
    breadboard: true,
  };
}

/** The same part lying on the mat at (x, y). */
function unplugged(pl: Placement, xy: [number, number]): Placement {
  return {
    ...pl,
    pos: [xy[0], xy[1], 0],
    rotZ: pl.matPose.rotZ,
    tilt: 0,
    offset: [0, 0, 0],
    w: pl.matPose.w,
    d: pl.matPose.d,
    h: pl.matPose.h,
    holes: undefined,
    breadboard: false,
  };
}

/** Lay the circuit out: breadboard, board beside it, parts in it or around it. Same input → same output. */
export function layoutMat(items: MatItem[], connections: Connection[], nets?: Net[]): MatLayout {
  if (items.length === 0) return { placements: [], breadboard: null, bounds: { minX: -40, maxX: 40, minY: -30, maxY: 30, maxZ: 10 } };
  const area = (p: LibraryPart) => p.dims.x * p.dims.y;
  const board =
    items.find((i) => i.part.category === "mcu") ??
    [...items].sort((a, b) => area(b.part) - area(a.part) || a.instanceId.localeCompare(b.instanceId))[0];
  const links = linksOf(connections);
  const netOf = pinNetMap(connections, nets);
  const partOf = new Map(items.map((i) => [i.instanceId, i.part]));

  // ── Which parts plug in, and which pin goes first ──
  const first = new Map<string, string>();
  const viaHost = new Map<string, { host: string; hostPin: string; farLeg: string }>();
  for (const c of connections) {
    const helper = c.viaPart ? partOf.get(c.viaPart) : undefined;
    if (!c.viaPart || !helper) continue;
    const legs = helperLegs(c, helper, netOf);
    if (!legs) continue;
    if (!first.has(c.viaPart)) first.set(c.viaPart, legs[0]);
    if (!first.has(c.to.part)) first.set(c.to.part, c.to.pin);
    viaHost.set(c.viaPart, { host: c.to.part, hostPin: c.to.pin, farLeg: legs[1] });
  }
  // A button's (or a lone LED's) ground side goes first: below the channel / leftmost.
  for (const c of connections) {
    if (c.role !== "ground" || first.has(c.to.part)) continue;
    first.set(c.to.part, c.to.pin);
  }
  const plugs = new Map<string, PlugSet>();
  for (const it of items) {
    if (it === board) continue;
    const ps = plugFor(it.part, first.get(it.instanceId));
    if (ps) plugs.set(it.instanceId, ps);
  }
  const pinNets = (inst: string): Record<string, string | null> => {
    const part = partOf.get(inst)!;
    return Object.fromEntries(part.pins.map((p) => [p.id, netOf.get(`${inst}.${p.id}`) ?? null]));
  };

  // ── Build order: the first connection that touches each part ──
  const orderOf = new Map<string, number>();
  connections.forEach((c, i) => {
    for (const id of [c.from.part, c.viaPart, c.to.part]) if (id && !orderOf.has(id)) orderOf.set(id, i);
  });
  const ordered = items
    .map((it, i) => ({ it, i }))
    .filter((x) => plugs.has(x.it.instanceId))
    .sort((a, b) => (orderOf.get(a.it.instanceId) ?? 1e6) - (orderOf.get(b.it.instanceId) ?? 1e6) || a.i - b.i)
    .map((x) => x.it);

  // ── Columns, on a full-size board first; half-size when it all fits ──
  const big = breadboardSpec(FULL_COLS);
  const anchors = new Map<string, number>();
  const occupants: Occupant[] = [];
  let cursor = FIRST_COL;
  let maxCol = -1;
  const occOf = (inst: string, plug: Plug, k: number): Occupant => {
    const nm = pinNets(inst);
    const o = plugOrigin(big, plug, k);
    return { holes: plugHoles(plug, k).map((h) => ({ col: h.col, row: h.row, net: nm[h.id] ?? null })), rect: { x: o[0], y: o[1], w: plug.w, d: plug.d } };
  };
  const tryAt = (inst: string, k: number): boolean => {
    const plug = plugs.get(inst)!.bottom;
    const nm = pinNets(inst);
    const ok = nearestFit(big, plug, k, (pin) => nm[pin] ?? null, occupants) === k;
    if (!ok) return false;
    anchors.set(inst, k);
    occupants.push(occOf(inst, plug, k));
    const cols = plugHoles(plug, k).map((h) => h.col);
    const o = plugOrigin(big, plug, k);
    const bodyHi = Math.ceil((o[0] + plug.w / 2 + big.w / 2 - 3.3) / 2.54 - 0.5);
    maxCol = Math.max(maxCol, ...cols, Math.min(big.cols - 1, bodyHi));
    cursor = Math.max(cursor, maxCol + 2);
    return true;
  };
  const placeNext = (inst: string) => {
    // Left to right from the cursor; fits() keeps bodies and nets apart.
    for (let k = cursor; k < big.cols; k++) if (tryAt(inst, k)) return;
  };
  // A series resistor goes in just before its host, so the host's leg can share its far column.
  const resOfHost = new Map<string, string>();
  for (const [r, v] of viaHost) if (!resOfHost.has(v.host) && plugs.has(r)) resOfHost.set(v.host, r);
  const tried = new Set<string>();
  const place = (id: string) => {
    if (tried.has(id) || !plugs.has(id)) return;
    tried.add(id);
    placeNext(id);
    const v = viaHost.get(id);
    if (v && anchors.has(id) && plugs.has(v.host) && !tried.has(v.host)) {
      tried.add(v.host);
      // The host's leg goes in the resistor's far column.
      const res = plugs.get(id)!.bottom;
      const farCol = anchors.get(id)! + (res.pins.find((q) => q.id === v.farLeg)?.dc ?? 0);
      const hp = plugs.get(v.host)!.bottom;
      const dc = hp.pins.find((q) => q.id === v.hostPin)?.dc ?? 0;
      const keep = cursor;
      cursor = farCol - dc;
      if (!tryAt(v.host, farCol - dc)) {
        cursor = keep;
        placeNext(v.host);
      }
    }
  };
  for (const it of ordered) {
    const r = resOfHost.get(it.instanceId);
    if (r) place(r);
    place(it.instanceId);
  }
  const cols = maxCol <= HALF_COLS - 1 ? HALF_COLS : FULL_COLS;
  const bb = breadboardSpec(cols, [0, 0]);

  // ── Board beside the breadboard (long side along it, busiest header facing it) ──
  const bPins = pins3dFor(board.part);
  const used = new Set<string>();
  for (const c of connections) {
    if (c.from.part === board.instanceId) used.add(c.from.pin);
    if (c.to.part === board.instanceId) used.add(c.to.pin);
  }
  const rots: Rot[] = board.part.dims.x > board.part.dims.y ? [90, 270] : [0, 180];
  const score = (r: Rot) => [...used].reduce((t, id) => t + (bPins[id] ? rotXY(bPins[id].pos[0], bPins[id].pos[1], r)[0] : 0), 0);
  const bRot = score(rots[1]) > score(rots[0]) + 1e-6 ? rots[1] : rots[0];
  const bfp = footprint(board.part, bRot);
  const bp: Placement = {
    instanceId: board.instanceId,
    partId: board.part.id,
    pos: [bb.pos[0] - bb.w / 2 - BOARD_GAP - bfp.w / 2, 0, 0],
    rotZ: bRot,
    ...bfp,
    board: true,
    breadboard: false,
    tilt: 0,
    offset: [0, 0, 0],
    matPose: { rotZ: bRot, ...bfp },
  };

  // Wires are routed on a grid aligned with the breadboard holes; a mat part sits so one wired pin is on it.
  const origin: [number, number] = [bb.pos[0] + colX(bb.cols, 0), bb.pos[1] + rowY(0)];
  const usedPins = (inst: string, part: LibraryPart) => {
    const pins = pins3dFor(part);
    const mine = new Set<string>();
    for (const c of connections) {
      if (c.from.part === inst) mine.add(c.from.pin);
      if (c.to.part === inst) mine.add(c.to.pin);
    }
    return part.pins.map((q) => q.id).filter((id) => mine.has(id) && pins[id]);
  };
  /** Shift (≤ one grid step, outward from the middle) so the first wired pin lies on the grid. */
  const align = (pl: Placement, part: LibraryPart, sx: number, sy: number) => {
    const id = usedPins(pl.instanceId, part)[0];
    if (!id) return;
    const q = pinWorld(pl, pins3dFor(part)[id]).pos;
    const snap = (v: number, o: number, s: number) => {
      const k = (v - o) / GRID;
      return o + (s > 0 ? Math.ceil(k - 1e-9) : s < 0 ? Math.floor(k + 1e-9) : Math.round(k)) * GRID - v;
    };
    pl.pos = [pl.pos[0] + snap(q[0], origin[0], sx), pl.pos[1] + snap(q[1], origin[1], sy), pl.pos[2]];
  };
  align(bp, board.part, -1, 0);
  bp.matPose = { ...bp.matPose };

  const placed = new Map<string, Placement>([[bp.instanceId, bp]]);
  // ── Plugged parts ──
  for (const it of items) {
    const k = anchors.get(it.instanceId);
    const ps = plugs.get(it.instanceId);
    if (k === undefined || !ps) continue;
    const mp = footprint(it.part, 0);
    const base: Placement = {
      instanceId: it.instanceId,
      partId: it.part.id,
      pos: [0, 0, 0],
      rotZ: 0,
      ...mp,
      board: false,
      breadboard: false,
      tilt: 0,
      offset: [0, 0, 0],
      matPose: { rotZ: 0, ...mp },
      plug: ps,
      pinNets: pinNets(it.instanceId),
    };
    placed.set(it.instanceId, plugged(bb, base, ps.bottom, k));
  }

  // ── Servo driver + its servos (Part E) ──
  const group = servoGroup(items, connections, partOf, {
    cx: (bp.pos[0] - bp.w / 2 + bb.pos[0] + bb.w / 2) / 2,
    top: Math.max(bb.d / 2, bp.d / 2),
  });
  for (const p of group) {
    const part = partOf.get(p.instanceId)!;
    align(p, part, 0, 1);
    placed.set(p.instanceId, p);
  }

  // ── Mat parts around the board + breadboard ──
  const core = {
    minX: Math.min(bp.pos[0] - bp.w / 2, ...group.map((p) => p.pos[0] - p.w / 2)),
    maxX: Math.max(bb.pos[0] + bb.w / 2, ...group.map((p) => p.pos[0] + p.w / 2)),
    minY: Math.min(-bb.d / 2, -bp.d / 2),
    maxY: Math.max(bb.d / 2, bp.d / 2, ...group.map((p) => p.pos[1] + p.d / 2)),
  };
  const cx = (core.minX + core.maxX) / 2;
  const cy = (core.minY + core.maxY) / 2;
  const hx = (core.maxX - core.minX) / 2;
  const hy = (core.maxY - core.minY) / 2;
  // Power / ground members lean toward the rail their net runs on.
  const rails = railNets(connections, { placements: [...placed.values()], breadboard: bb });
  const targetOf = (l: Link): [number, number] | null => {
    const row = rails.get(l.net);
    if (row !== undefined) return [bb.pos[0] - bb.w / 4, bb.pos[1] + rowY(row)];
    const pl = placed.get(l.other);
    if (!pl) return null;
    if (pl.breadboard && l.theirs) {
      const h = pl.holes?.find((q) => q.id === l.theirs);
      if (h) {
        const p = holeWorld(bb, h);
        return [p[0], p[1]];
      }
    }
    const part = partOf.get(l.other);
    const pin = part && l.theirs ? pins3dFor(part)[l.theirs] : undefined;
    if (pin) {
      const p = pinWorld(pl, pin).pos;
      return [p[0], p[1]];
    }
    return [pl.pos[0], pl.pos[1]];
  };
  const others = items.filter((i) => !placed.has(i.instanceId));
  const sideOf = new Map<string, [number, number]>();
  const lean = (it: MatItem): [number, number] | null => {
    let sx = 0;
    let sy = 0;
    let wsum = 0;
    for (const l of links.get(it.instanceId) ?? []) {
      let p: [number, number] | null = targetOf(l);
      if (p) p = [(p[0] - cx) / hx, (p[1] - cy) / hy];
      else if (sideOf.has(l.other)) p = sideOf.get(l.other)!;
      if (!p) continue;
      sx += p[0] * l.weight;
      sy += p[1] * l.weight;
      wsum += l.weight;
    }
    return wsum > 0 ? [sx / wsum, sy / wsum] : null;
  };
  type Draft = { item: MatItem; side: Side; key: number; v: [number, number]; rot: Rot; order: number };
  const sideCount: Record<Side, number> = { right: 0, bottom: 0, left: 0, top: 0 };
  const drafts: Draft[] = [];
  const keyFor = (side: Side, v: [number, number]) => (side === "left" || side === "right" ? -v[1] : v[0]);
  const direct = (o: MatItem) => (links.get(o.instanceId) ?? []).some((l) => placed.has(l.other));
  const seq = [...others.filter(direct), ...others.filter((o) => !direct(o))];
  for (const [order, it] of seq.entries()) {
    const v = lean(it);
    let side: Side;
    if (v && Math.hypot(v[0], v[1]) > 0.05) {
      side = Math.abs(v[0]) >= Math.abs(v[1]) ? (v[0] >= 0 ? "right" : "left") : v[1] >= 0 ? "top" : "bottom";
    } else {
      side = [...SIDES].sort((a, b) => sideCount[a] - sideCount[b] || SIDES.indexOf(a) - SIDES.indexOf(b))[0];
    }
    sideCount[side]++;
    sideOf.set(it.instanceId, SIDE_VEC[side]);
    const vv = v ?? [0, 0];
    drafts.push({ item: it, side, key: keyFor(side, vv), v: vv, rot: 0, order });
  }

  // A crowded side spills its end parts onto the neighbouring sides.
  const NEXT: Record<Side, [Side, Side]> = { bottom: ["left", "right"], top: ["left", "right"], left: ["top", "bottom"], right: ["top", "bottom"] };
  const alongLen = (d: Draft) => Math.max(d.item.part.dims.x, d.item.part.dims.y);
  const limit = (side: Side) => (side === "left" || side === "right" ? hy * 2 : hx * 2) + 50;
  for (const side of SIDES) {
    for (let guard = 0; guard < 20; guard++) {
      const row = drafts.filter((d) => d.side === side).sort((a, b) => a.key - b.key || a.order - b.order);
      if (row.length < 2) break;
      const total = row.reduce((t, d) => t + alongLen(d), 0) + GAP * (row.length - 1);
      if (total <= limit(side)) break;
      const firstD = row[0];
      const lastD = row[row.length - 1];
      const mover = Math.abs(firstD.key) > Math.abs(lastD.key) ? firstD : lastD;
      const to = mover === firstD ? NEXT[side][0] : NEXT[side][1];
      if (drafts.filter((d) => d.side === to).length >= row.length - 1) break;
      mover.side = to;
      mover.key = keyFor(to, mover.v);
    }
  }

  // Turn each part so its wired pins face the middle.
  for (const d of drafts) {
    const pins = pins3dFor(d.item.part);
    const mine = (links.get(d.item.instanceId) ?? []).map((l) => l.mine).filter((x): x is string => !!x && !!pins[x]);
    if (!mine.length) continue;
    const mx = mine.reduce((t, id) => t + pins[id].pos[0], 0) / mine.length;
    const my = mine.reduce((t, id) => t + pins[id].pos[1], 0) / mine.length;
    if (Math.hypot(mx, my) <= 1) continue;
    const want = Math.atan2(-SIDE_VEC[d.side][1], -SIDE_VEC[d.side][0]);
    const have = Math.atan2(my, mx);
    const deg = (((want - have) * 180) / Math.PI + 720) % 360;
    d.rot = ((Math.round(deg / 90) * 90) % 360) as Rot;
  }

  const blockers: Rect[] = [rectOf(bp), { x: bb.pos[0], y: bb.pos[1], w: bb.w, d: bb.d }, ...group.map(rectOf)];
  const matPlaced: Placement[] = [];
  for (const side of SIDES) {
    const row = drafts.filter((d) => d.side === side).sort((a, b) => a.key - b.key || a.order - b.order);
    if (!row.length) continue;
    const fps = row.map((d) => footprint(d.item.part, d.rot));
    const along = (f: { w: number; d: number }) => (side === "left" || side === "right" ? f.d : f.w);
    const total = fps.reduce((t, f) => t + along(f), 0) + GAP * (fps.length - 1);
    let c = -total / 2;
    row.forEach((d, i) => {
      const f = fps[i];
      const a = c + along(f) / 2;
      c += along(f) + GAP;
      let x: number;
      let y: number;
      if (side === "right") [x, y] = [core.maxX + GAP + f.w / 2, cy - a];
      else if (side === "left") [x, y] = [core.minX - GAP - f.w / 2, cy - a];
      else if (side === "top") [x, y] = [cx + a, core.maxY + GAP + f.d / 2];
      else [x, y] = [cx + a, core.minY - GAP - f.d / 2];
      const p: Placement = {
        instanceId: d.item.instanceId,
        partId: d.item.part.id,
        pos: [x, y, 0],
        rotZ: d.rot,
        ...f,
        board: false,
        breadboard: false,
        tilt: 0,
        offset: [0, 0, 0],
        matPose: { rotZ: d.rot, ...f },
      };
      if (plugs.has(d.item.instanceId)) {
        p.plug = plugs.get(d.item.instanceId);
        p.pinNets = pinNets(d.item.instanceId);
      }
      const [vx, vy] = SIDE_VEC[side];
      align(p, d.item.part, vx || (x >= cx ? 1 : -1), vy || (y >= cy ? 1 : -1));
      const hit = () => [...blockers, ...matPlaced.map(rectOf)].some((q) => overlapsR(rectOf(p), q, CLEAR));
      // Pushed out in whole grid steps, so the pin stays on the grid.
      for (let k = 0; k < 400 && hit(); k++) p.pos = [p.pos[0] + vx * GRID, p.pos[1] + vy * GRID, 0];
      matPlaced.push(p);
      placed.set(p.instanceId, p);
    });
  }

  const placements = items.map((i) => placed.get(i.instanceId)!).filter(Boolean);
  return { placements, breadboard: bb, bounds: boundsOf(placements, bb) };
}

/** Gap between two servos in the servo row, and between the driver and the row (mm): room for a few wire lanes. */
const SERVO_GAP = 16;

/**
 * The rotation (0/90/180/270) that turns the mean of `pins` (local) toward `dir` on the mat,
 * measured from the part's centre, or from the mean of `from` pins when given.
 */
function rotToward(part: LibraryPart, pinIds: string[], dir: [number, number], from: string[] = []): Rot {
  const pins = pins3dFor(part);
  const ids = pinIds.filter((id) => pins[id]);
  if (!ids.length) return 0;
  const mean = (list: string[], k: 0 | 1) => list.reduce((t, id) => t + pins[id].pos[k], 0) / list.length;
  const base = from.filter((id) => pins[id]);
  const mx = mean(ids, 0) - (base.length ? mean(base, 0) : 0);
  const my = mean(ids, 1) - (base.length ? mean(base, 1) : 0);
  let best: Rot = 0;
  let bestDot = -Infinity;
  for (const r of [0, 90, 180, 270] as Rot[]) {
    const [x, y] = rotXY(mx, my, r);
    const dot = x * dir[0] + y * dir[1];
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = r;
    }
  }
  return best;
}

/**
 * Part E: a servo driver and the servos plugged into its channels, laid out above the board
 * + breadboard (`at.top` = their top edge, `at.cx` = their middle): the driver first, channel
 * headers up; then one row of servos in channel order, leads down toward the driver.
 * Empty when the circuit has no servo plugs.
 */
function servoGroup(
  items: MatItem[],
  connections: Connection[],
  partOf: Map<string, LibraryPart>,
  at: { cx: number; top: number },
): Placement[] {
  const plugs = connections.filter((c) => c.bundle && c.channel !== undefined).sort((a, b) => a.channel! - b.channel!);
  if (!plugs.length) return [];
  const drvId = plugs[0].from.part;
  const drvPart = partOf.get(drvId);
  if (!drvPart || !items.some((i) => i.instanceId === drvId)) return [];
  const make = (instanceId: string, part: LibraryPart, rot: Rot, x: number, y: number): Placement => {
    const f = footprint(part, rot);
    return {
      instanceId,
      partId: part.id,
      pos: [x, y, 0],
      rotZ: rot,
      ...f,
      board: false,
      breadboard: false,
      tilt: 0,
      offset: [0, 0, 0],
      matPose: { rotZ: rot, ...f },
    };
  };
  const chPins = plugs.flatMap((c) => [c.from.pin, ...(c.bundle ?? []).map((b) => b.from.pin)]);
  // Channel headers up (away from the board), the I2C header down toward it.
  const dRot = rotToward(drvPart, chPins, [0, 1], drvPart.pins.filter((q) => /^(SDA|SCL)$/.test(q.id)).map((q) => q.id));
  const df = footprint(drvPart, dRot);
  const drv = make(drvId, drvPart, dRot, at.cx, at.top + GAP + df.d / 2);
  const out: Placement[] = [drv];
  // Servos: one row above the driver, centred on the used channel headers.
  const servos = plugs
    .map((c) => ({ c, part: partOf.get(c.to.part) }))
    .filter((x): x is { c: Connection; part: LibraryPart } => !!x.part && items.some((i) => i.instanceId === x.c.to.part));
  if (!servos.length) return out;
  const rows = servos.map(({ c, part }) => {
    const rot = rotToward(part, [c.to.pin, ...(c.bundle ?? []).map((b) => b.to.pin)], [0, -1]);
    return { c, part, rot, f: footprint(part, rot) };
  });
  const dPins = pins3dFor(drvPart);
  const headerXs = plugs.map((c) => dPins[c.from.pin]).filter(Boolean).map((q) => drv.pos[0] + rotXY(q.pos[0], q.pos[1], dRot)[0]);
  const hx = headerXs.length ? (Math.min(...headerXs) + Math.max(...headerXs)) / 2 : drv.pos[0];
  const total = rows.reduce((t, r) => t + r.f.w, 0) + SERVO_GAP * (rows.length - 1);
  const y0 = drv.pos[1] + df.d / 2 + SERVO_GAP + GAP;
  let x = hx - total / 2;
  for (const r of rows) {
    out.push(make(r.c.to.part, r.part, r.rot, x + r.f.w / 2, y0 + r.f.d / 2));
    x += r.f.w + SERVO_GAP;
  }
  return out;
}

/** Footprint bounds of a set of placements and the breadboard, mm. */
export function boundsOf(placements: Placement[], bb?: BreadboardSpec | null): MatLayout["bounds"] {
  if (!placements.length && !bb) return { minX: -40, maxX: 40, minY: -30, maxY: 30, maxZ: 10 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
  for (const p of placements) {
    minX = Math.min(minX, p.pos[0] - p.w / 2);
    maxX = Math.max(maxX, p.pos[0] + p.w / 2);
    minY = Math.min(minY, p.pos[1] - p.d / 2);
    maxY = Math.max(maxY, p.pos[1] + p.d / 2);
    maxZ = Math.max(maxZ, p.pos[2] + p.h);
  }
  if (bb) {
    minX = Math.min(minX, bb.pos[0] - bb.w / 2);
    maxX = Math.max(maxX, bb.pos[0] + bb.w / 2);
    minY = Math.min(minY, bb.pos[1] - bb.d / 2);
    maxY = Math.max(maxY, bb.pos[1] + bb.d / 2);
    maxZ = Math.max(maxZ, bb.h);
  }
  return { minX, maxX, minY, maxY, maxZ };
}

// ── Moving parts by hand (drag on the mat) ─────────────────────────────────

/** Client-moved part centres on the mat (x, y mm), keyed by instanceId. */
export type MatMoves = Record<string, [number, number]>;

const reach = (v: number) => Math.max(-MAX_REACH, Math.min(MAX_REACH, v));

/** What a part on the mat must stay clear of (`overBoard`: a pluggable part may pass over the breadboard). */
function obstacles(layout: MatLayout, id: string, overBoard: boolean): Rect[] {
  const out = layout.placements.filter((q) => q.instanceId !== id && !q.breadboard).map(rectOf);
  if (layout.breadboard && !overBoard) {
    const bb = layout.breadboard;
    out.push({ x: bb.pos[0], y: bb.pos[1], w: bb.w, d: bb.d });
  }
  return out;
}

const clashesR = (p: { w: number; d: number }, x: number, y: number, others: Rect[], clear: number) =>
  others.some((q) => Math.abs(x - q.x) * 2 < p.w + q.w + clear * 2 && Math.abs(y - q.y) * 2 < p.d + q.d + clear * 2);

/**
 * Where a dragged part may go: the wanted spot when it is clear; else pushed out
 * of whatever it hits along the shorter way; else the furthest clear point on
 * the way from where it was. A part that can plug in may pass over the
 * breadboard (it snaps when dropped there); `strict` makes the breadboard an
 * obstacle for it too. Stays within MAX_REACH of the mat centre. Pure.
 */
export function resolveMove(layout: MatLayout, id: string, want: [number, number], from?: [number, number], strict = false): [number, number] {
  const p0 = layout.placements.find((q) => q.instanceId === id);
  if (!p0) return want;
  const p = p0.matPose;
  const others = obstacles(layout, id, !!p0.plug && !strict);
  const start: [number, number] = from ?? [p0.pos[0], p0.pos[1]];
  let x = reach(want[0]);
  let y = reach(want[1]);
  if (!clashesR(p, x, y, others, MOVE_CLEAR)) return [x, y];
  for (let k = 0; k < 6; k++) {
    const hit = others.find((q) => clashesR(p, x, y, [q], MOVE_CLEAR));
    if (!hit) break;
    const px = (p.w + hit.w) / 2 + MOVE_CLEAR - Math.abs(x - hit.x);
    const py = (p.d + hit.d) / 2 + MOVE_CLEAR - Math.abs(y - hit.y);
    if (px < py) x += (x >= hit.x ? 1 : -1) * (px + 0.01);
    else y += (y >= hit.y ? 1 : -1) * (py + 0.01);
    x = reach(x);
    y = reach(y);
  }
  if (!clashesR(p, x, y, others, MOVE_CLEAR)) return [x, y];
  if (clashesR(p, start[0], start[1], others, MOVE_CLEAR)) return start;
  let lo = 0;
  let hi = 1;
  const at = (t: number): [number, number] => [reach(start[0] + (want[0] - start[0]) * t), reach(start[1] + (want[1] - start[1]) * t)];
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2;
    const [mx, my] = at(mid);
    if (clashesR(p, mx, my, others, MOVE_CLEAR)) hi = mid;
    else lo = mid;
  }
  return at(lo);
}

/** Plug `id` in near (x, y) on the breadboard, or null when no free columns fit it. */
export function snapToBreadboard(layout: MatLayout, id: string, xy: [number, number]): Placement | null {
  const bb = layout.breadboard;
  const p = layout.placements.find((q) => q.instanceId === id);
  if (!bb || !p?.plug) return null;
  const plug = xy[1] > bb.pos[1] ? p.plug.top : p.plug.bottom;
  const others = layout.placements.filter((q) => q.instanceId !== id && q.breadboard).map((q) => occupantOf(bb, q));
  const nets = p.pinNets ?? {};
  const k = nearestFit(bb, plug, anchorNear(bb, plug, xy[0]), (pin) => nets[pin] ?? null, others);
  return k === null ? null : plugged(bb, p, plug, k);
}

/**
 * Where a drop ends up: plugged into the nearest free columns when it is over
 * the breadboard and fits there, else a clear spot on the mat. Returns the
 * part's centre (what applyMoves takes back). Pure.
 */
export function settleMove(layout: MatLayout, id: string, xy: [number, number]): [number, number] {
  const p = layout.placements.find((q) => q.instanceId === id);
  if (p?.plug && layout.breadboard && overTerminals(layout.breadboard, xy[0], xy[1])) {
    const s = snapToBreadboard(layout, id, xy);
    if (s) return [s.pos[0], s.pos[1]];
  }
  return resolveMove(layout, id, xy, undefined, true);
}

/**
 * Put one part at (x, y) (live drag). A plugged part comes out of its holes but
 * keeps its pose and height while it is carried; the drop (applyMoves) decides
 * whether it plugs in again or lies on the mat. Returns a new layout.
 */
export function movePart(layout: MatLayout, id: string, xy: [number, number]): MatLayout {
  const placements = layout.placements.map((p) =>
    p.instanceId !== id ? p : { ...p, pos: [xy[0], xy[1], p.pos[2]] as Vec3, holes: undefined, breadboard: false },
  );
  return { ...layout, placements, bounds: boundsOf(placements, layout.breadboard) };
}

/**
 * The auto layout with the client's moves on top (in placement order). A move
 * over the breadboard plugs the part into the nearest free columns; a move that
 * is gone, out of reach or would overlap (the parts changed) is dropped.
 * Same input → same output.
 */
export function applyMoves(layout: MatLayout, moves: MatMoves): MatLayout {
  let out = layout;
  for (const p of layout.placements) {
    const m = moves[p.instanceId];
    if (!m || !Number.isFinite(m[0]) || !Number.isFinite(m[1])) continue;
    if (Math.abs(m[0]) > MAX_REACH || Math.abs(m[1]) > MAX_REACH) continue;
    const cur = out.placements.find((q) => q.instanceId === p.instanceId)!;
    let next: Placement | null = null;
    if (cur.plug && out.breadboard && overTerminals(out.breadboard, m[0], m[1])) {
      next = snapToBreadboard(out, p.instanceId, m);
    } else {
      const cand = unplugged(cur, m);
      if (!clashesR(cand, m[0], m[1], obstacles(out, p.instanceId, false), MOVE_CLEAR)) next = cand;
    }
    if (!next) continue;
    const placements = out.placements.map((q) => (q.instanceId === p.instanceId ? next! : q));
    out = { ...out, placements, bounds: boundsOf(placements, out.breadboard) };
  }
  return out;
}

/** "Take it apart": how high each part rises (the board and the breadboard stay down). */
export function apartLift(layout: MatLayout): Map<string, number> {
  const m = new Map<string, number>();
  let k = 0;
  for (const p of layout.placements) {
    if (p.board) m.set(p.instanceId, 0);
    else m.set(p.instanceId, (p.breadboard ? 26 : 34) + 10 * (k++ % 3));
  }
  return m;
}
