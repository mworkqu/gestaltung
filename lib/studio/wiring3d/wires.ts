// 3D wiring (P5-17 / P5-17e): jumper wires, the way you'd wire it on a breadboard.
//
// Pure. Every segment is a short jumper with an id = ONE Connection id:
//   * a part plugged into the breadboard is reached through a free hole in its
//     own column (same column group = connected, like a real breadboard);
//   * power and ground nets the board or a plugged part is on run along the
//     rails: ground → bottom − rail; the busiest supply net → bottom + rail,
//     a second one → top + rail. The net's hub (the connection's `from`, e.g.
//     the board's GND or a supply's OUT) gets ONE feed jumper into the rail,
//     every other member one jumper from its pin / column to the rail;
//   * a series resistor (Connection.viaPart) sits in the breadboard: one jumper
//     from the board pin into the resistor's near column; its far leg shares a
//     column with the host's leg, so nothing else is needed (if the host is on
//     the mat, a jumper runs from the far column to it);
//   * everything else is one jumper from end to end (pin or column hole).
//
// SELECTION RULE for a rail feed jumper: it belongs to the FIRST connection of
// that net in build order (its id and colour; picking it selects that one), and
// `shared` lists every connection of the net, so the view also lights the feed
// whenever any connection of that net is highlighted (it is on all their paths).
//
// Shape: a jumper leaves a hole straight up, arches a few mm above the board
// and drops into the other hole; longer runs (board / mat parts) arch higher.
// The control points go through a centripetal Catmull-Rom spline in the view.

import type { Connection, WireColour } from "../connections";
import type { LibraryPart, Net } from "../schema";
import { colX, groupHoles, groupOf, holeWorld, isRailCol, RAIL, type Hole } from "./breadboard";
import { pinWorld, type MatLayout, type Placement } from "./layout";
import { railNets } from "./rails";

export { railNets } from "./rails";
import { pins3dFor, type Pin3d, type Vec3 } from "./pins3d";

export type WireEnd = { kind: "pin"; part: string; pin: string } | { kind: "hole"; col: number; row: number };

export type WireSegment = {
  /** Connection id (c1…): the one this jumper belongs to. */
  id: string;
  /** Index of this segment within its connection (0 = first laid). */
  part: number;
  colour: WireColour;
  points: Vec3[];
  ends: [WireEnd, WireEnd];
  /** Rail feed: every connection of the net (the view lights the feed for any of them). */
  shared?: string[];
};

/** Straight lead out of a pin before the wire bends (mm). */
export const LEAD = 5;
/** Straight rise out of a breadboard hole (mm). */
export const HOLE_LEAD = 2.6;

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/**
 * Control points for a free wire: pin, a short lead along each exit direction,
 * a lifted midpoint (higher for longer wires). `spread` shifts the midpoint
 * sideways so parallel wires don't sit in one tube.
 */
export function wirePath(a: Pin3d, b: Pin3d, spread = 0, leadA = LEAD, leadB = LEAD): Vec3[] {
  const a1 = add(a.pos, a.dir, leadA);
  const b1 = add(b.pos, b.dir, leadB);
  const dx = b1[0] - a1[0];
  const dy = b1[1] - a1[1];
  const flat = Math.hypot(dx, dy);
  const top = Math.max(a1[2], b1[2]) + 6 + flat * 0.14;
  const nx = flat > 1e-6 ? -dy / flat : 1;
  const ny = flat > 1e-6 ? dx / flat : 0;
  const mid: Vec3 = [(a1[0] + b1[0]) / 2 + nx * spread, (a1[1] + b1[1]) / 2 + ny * spread, top];
  if (flat < 2 && Math.abs(a1[2] - b1[2]) < 2) return [a.pos, a1, b1, b.pos];
  return [a.pos, a1, mid, b1, b.pos];
}

/**
 * A short breadboard jumper: up out of one hole, across, down into the other.
 * `over` = the height it must clear (a module it crosses): then it rises out of
 * the holes and arches over that.
 */
export function jumperPath(a: Vec3, b: Vec3, over = 0): Vec3[] {
  const flat = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lift = HOLE_LEAD + Math.min(6, flat * 0.07);
  const top = Math.max(a[2], b[2]) + lift;
  if (over + 2 <= top) return [a, [a[0], a[1], top], [b[0], b[1], top], b];
  const up = Math.max(a[2], b[2]) + HOLE_LEAD;
  return [a, [a[0], a[1], up], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, over + 2], [b[0], b[1], up], b];
}

/** The helper leg on the board side of a via connection, then the other one. */
export function viaLegs(c: Connection, helper: LibraryPart, nets: Net[]): [string, string] | null {
  if (!c.viaPart || helper.pins.length < 2) return null;
  const net = nets.find((n) => n.name === c.net);
  const near = helper.pins.find((p) => net?.pins.includes(`${c.viaPart}.${p.id}`)) ?? helper.pins[0];
  const far = helper.pins.find((p) => p.id !== near.id);
  return far ? [near.id, far.id] : null;
}

export type WireInput = {
  connections: Connection[];
  layout: MatLayout;
  getPart: (partId: string) => LibraryPart | undefined;
  nets: Net[];
  /** Per-instance lift ("Take it apart"), mm. The breadboard and its holes stay down. */
  lift?: (instanceId: string) => number;
  /** Only return these connections' segments (everything is still routed, so holes match the full build). */
  only?: (c: Connection) => boolean;
};

/** Does this connection touch the part (either end or its series helper)? */
export const touchesPart = (c: Connection, instanceId: string) =>
  c.from.part === instanceId || c.to.part === instanceId || c.viaPart === instanceId;

type End = { pt: Pin3d; end: WireEnd; hole: boolean };

/** Every jumper of the circuit, in connection order. Ends with a missing part/pin are skipped. */
export function buildWires({ connections, layout, getPart, nets, lift, only }: WireInput): WireSegment[] {
  const byId = new Map<string, Placement>(layout.placements.map((p) => [p.instanceId, p]));
  const bb = layout.breadboard;
  const taken = new Set<string>();
  for (const p of layout.placements) if (p.breadboard) for (const h of p.holes ?? []) taken.add(`${h.col}:${h.row}`);
  const UP: Vec3 = [0, 0, 1];

  const holeEnd = (h: Hole): End => ({ pt: { pos: holeWorld(bb!, h), dir: UP }, end: { kind: "hole", col: h.col, row: h.row }, hole: true });
  /** A free hole in a column group (outermost row first). */
  const inGroup = (col: number, upper: boolean): Hole => {
    const hs = groupHoles(col, upper);
    const h = hs.find((x) => !taken.has(`${x.col}:${x.row}`)) ?? hs[0];
    taken.add(`${h.col}:${h.row}`);
    return h;
  };
  /** The free hole of a rail nearest to x (mat mm). */
  const railHole = (row: number, x: number): Hole => {
    let best: Hole | null = null;
    let bestD = Infinity;
    for (let col = 0; col < bb!.cols; col++) {
      if (!isRailCol(col) || taken.has(`${col}:${row}`)) continue;
      const d = Math.abs(bb!.pos[0] + colX(bb!.cols, col) - x);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = { col, row };
      }
    }
    const h = best ?? { col: 0, row };
    taken.add(`${h.col}:${h.row}`);
    return h;
  };
  const pinPt = (inst: string, partId: string, pin: string): Pin3d | null => {
    const pl = byId.get(inst);
    const part = getPart(partId);
    const p = part ? pins3dFor(part)[pin] : undefined;
    return pl && p ? pinWorld(pl, p, lift?.(inst) ?? 0) : null;
  };
  /** Where a jumper meets this pin: a free hole in its column when plugged in, else the pin itself. */
  const resolve = (inst: string, partId: string, pin: string): End | null => {
    const pl = byId.get(inst);
    const h = bb && pl?.breadboard ? pl.holes?.find((q) => q.id === pin) : undefined;
    if (h) return holeEnd(inGroup(h.col, h.row >= 5));
    const pt = pinPt(inst, partId, pin);
    return pt ? { pt, end: { kind: "pin", part: inst, pin }, hole: false } : null;
  };
  const plugged = layout.placements.filter((p) => p.breadboard);
  /** Top of the tallest plugged part the straight line a → b passes over. */
  const overTop = (a: Vec3, b: Vec3): number => {
    let top = 0;
    for (let k = 1; k < 12; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / 12;
      const y = a[1] + ((b[1] - a[1]) * k) / 12;
      for (const p of plugged) {
        if (Math.abs(x - p.pos[0]) * 2 < p.w + 1 && Math.abs(y - p.pos[1]) * 2 < p.d + 1) top = Math.max(top, p.pos[2] + p.h);
      }
    }
    return top;
  };
  const path = (a: End, b: End, spread: number): Vec3[] =>
    a.hole && b.hole
      ? jumperPath(a.pt.pos, b.pt.pos, overTop(a.pt.pos, b.pt.pos))
      : wirePath(a.pt, b.pt, spread, a.hole ? HOLE_LEAD : LEAD, b.hole ? HOLE_LEAD : LEAD);

  const rails = railNets(connections, layout);
  const byConn = new Map(connections.map((c) => [c.id, c]));
  const fed = new Set<string>();
  let bridged = false;
  const all: { id: string; colour: WireColour; a: End; b: End; spread: number; shared?: string[] }[] = [];
  connections.forEach((c, i) => {
    const spread = ((i % 5) - 2) * 1.6;
    const push = (a: End, b: End, shared?: string[]) => all.push({ id: c.id, colour: c.wireColour, a, b, spread, shared });
    const helper = c.viaPartId ? getPart(c.viaPartId) : undefined;
    const legs = c.viaPart && helper ? viaLegs(c, helper, nets) : null;
    const hp = c.viaPart ? byId.get(c.viaPart) : undefined;
    const rail = rails.get(c.net);
    const netIds = () => connections.filter((x) => x.net === c.net).map((x) => x.id);

    if (c.viaPart && c.viaPartId && legs && bb && hp?.breadboard) {
      const a = resolve(c.from.part, c.from.partId, c.from.pin);
      const near = hp.holes?.find((q) => q.id === legs[0]);
      const far = hp.holes?.find((q) => q.id === legs[1]);
      if (!a || !near || !far) return;
      push(a, holeEnd(inGroup(near.col, near.row >= 5)));
      const host = byId.get(c.to.part);
      const hh = host?.breadboard ? host.holes?.find((q) => q.id === c.to.pin) : undefined;
      if (!hh || groupOf(hh) !== groupOf(far)) {
        const b = resolve(c.to.part, c.to.partId, c.to.pin);
        if (b) push(holeEnd(inGroup(far.col, far.row >= 5)), b);
      }
    } else if (c.viaPart && c.viaPartId && legs) {
      const a = resolve(c.from.part, c.from.partId, c.from.pin);
      const b = resolve(c.to.part, c.to.partId, c.to.pin);
      const ha = resolve(c.viaPart, c.viaPartId, legs[0]);
      const hb = resolve(c.viaPart, c.viaPartId, legs[1]);
      if (!a || !b) return;
      if (ha && hb) {
        push(a, ha);
        push(hb, b);
      } else push(a, b);
    } else if (rail !== undefined && bb) {
      const owner = connections.find((x) => x.net === c.net)!;
      const feed = (a: End, b: End) => all.push({ id: owner.id, colour: owner.wireColour, a, b, spread, shared: netIds() });
      if (!fed.has(c.net)) {
        fed.add(c.net);
        const hub = resolve(c.from.part, c.from.partId, c.from.pin);
        if (hub) feed(hub, holeEnd(railHole(rail, hub.pt.pos[0])));
      }
      const t = resolve(c.to.part, c.to.partId, c.to.pin);
      if (!t) return;
      // Ground above the board's middle uses the top − rail, bridged once to the bottom one.
      let row = rail;
      if (rail === RAIL.bottomMinus && t.pt.pos[1] > bb.pos[1] + 1e-6) {
        row = RAIL.topMinus;
        if (!bridged) {
          bridged = true;
          const xr = bb.pos[0] + bb.w / 2;
          feed(holeEnd(railHole(RAIL.bottomMinus, xr)), holeEnd(railHole(RAIL.topMinus, xr)));
        }
      }
      push(t, holeEnd(railHole(row, t.pt.pos[0])));
    } else {
      const a = resolve(c.from.part, c.from.partId, c.from.pin);
      const b = resolve(c.to.part, c.to.partId, c.to.pin);
      if (a && b) push(a, b);
    }
  });

  const parts = new Map<string, number>();
  const out: WireSegment[] = [];
  for (const s of all) {
    const k = parts.get(s.id) ?? 0;
    parts.set(s.id, k + 1);
    const c = byConn.get(s.id);
    if (only && c && !only(c)) continue;
    const seg: WireSegment = { id: s.id, part: k, colour: s.colour, points: path(s.a, s.b, s.spread), ends: [s.a.end, s.b.end] };
    if (s.shared) seg.shared = s.shared;
    out.push(seg);
  }
  return out;
}
