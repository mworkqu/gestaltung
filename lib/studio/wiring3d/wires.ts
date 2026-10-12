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
// Shape (P5-17f, the tidy Fritzing look): every jumper is routed on the mat by
// route.ts — straight runs with right-angle turns, lying low and flat on the
// mat or on the breadboard top, parallel wires one lane apart, around parts.
// Only the ends rise: straight up out of a header pin / a hole (riding over
// the wire's own part to its edge, then down its side), or out of a side lead
// and down to the mat. A wire that climbs onto the breadboard goes straight up
// its edge. Where a wire crosses an earlier one it hops over it in a small
// bridge. Corners are rounded (BEND_R on the mat, STEP_R on steps / risers),
// so `points` is already the smooth centre line the view sweeps a tube along.
// The 2D route depends only on the layout (not on "Take it apart"), so wires
// keep their lanes while parts lift and the risers stretch.

import type { Connection, WireColour } from "../connections";
import type { LibraryPart, Net } from "../schema";
import { colX, groupHoles, groupOf, holeWorld, isRailCol, RAIL, rowY, type Hole } from "./breadboard";
import { pinWorld, type MatLayout, type Placement } from "./layout";
import { railNets } from "./rails";
import { LANE_GAP, ROUTE_CLEAR, routeWires, type Box, type Route, type RouteNet, type RouteObstacle, type XY } from "./route";

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
  /** The 2D run on the mat (grid corners), for tests and debugging. */
  run?: XY[];
  /** How many wires it hops over. */
  hops?: number;
};

/** Straight lead out of a side pin before the wire drops to the mat (mm). */
export const LEAD = 4;
/** Wire radius the paths are built for (mm; the view draws the same). */
export const WIRE_R = 1.1;
/** Corner radius of a turn on the mat / of a step or a riser (mm). */
export const BEND_R = 2.4;
const STEP_R = 1.1;
/** Height a wire hops over another one it crosses (mm, centre to centre). */
export const HOP = WIRE_R * 2 + 0.5;

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
  const rails = railNets(connections, layout);
  const byConn = new Map(connections.map((c) => [c.id, c]));
  const fed = new Set<string>();
  let bridged = false;
  const all: { id: string; colour: WireColour; a: End; b: End; shared?: string[] }[] = [];
  connections.forEach((c) => {

    const push = (a: End, b: End, shared?: string[]) => all.push({ id: c.id, colour: c.wireColour, a, b, shared });
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
      const feed = (a: End, b: End) => all.push({ id: owner.id, colour: owner.wireColour, a, b, shared: netIds() });
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

  const plan = planRoutes(all, layout);
  const ctx = floorContext(layout, getPart, lift);
  const parts = new Map<string, number>();
  const out: WireSegment[] = [];
  all.forEach((s, i) => {
    const k = parts.get(s.id) ?? 0;
    parts.set(s.id, k + 1);
    const c = byConn.get(s.id);
    if (only && c && !only(c)) return;
    const route = plan.routes[i];
    const seg: WireSegment = {
      id: s.id,
      part: k,
      colour: s.colour,
      points: wirePoints(s.a, s.b, route, ctx),
      ends: [s.a.end, s.b.end],
      run: route.points,
      hops: route.crossings.length,
    };
    if (s.shared) seg.shared = s.shared;
    out.push(seg);
  });
  return out;
}

// ── Routing on the mat ─────────────────────────────────────────────────────

const isUp = (dir: Vec3) => dir[2] > 0.7;

/** Where the flat run starts for an end (mat mm): the hole / pin itself, or a lead's length out of a side pin. */
function exitXY(e: End, origin: XY): XY {
  const [x, y] = [e.pt.pos[0], e.pt.pos[1]];
  if (e.hole || isUp(e.pt.dir)) return [x, y];
  const [dx, dy] = [e.pt.dir[0], e.pt.dir[1]];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ex = x + ux * LEAD;
  const ey = y + uy * LEAD;
  // An axis-aligned lead ends on a grid line (outward), so the run starts without a jog.
  const onLine = (v: number, o: number, s: number) =>
    o + (s > 0 ? Math.ceil((v - o) / LANE_GAP - 1e-6) : Math.floor((v - o) / LANE_GAP + 1e-6)) * LANE_GAP;
  if (Math.abs(ux) > 0.99) return [onLine(ex, origin[0], ux), ey];
  if (Math.abs(uy) > 0.99) return [ex, onLine(ey, origin[1], uy)];
  return [ex, ey];
}

/** The grid is aligned with the breadboard: its columns and terminal rows lie on grid lines. */
export function gridOrigin(layout: Pick<MatLayout, "breadboard">): XY {
  const bb = layout.breadboard;
  return bb ? [bb.pos[0] + colX(bb.cols, 0), bb.pos[1] + rowY(0)] : [0, 0];
}

const boxOf = (p: Placement): Box => ({ x: p.pos[0], y: p.pos[1], w: p.w, d: p.d });
const ownParts = (a: End, b: End) => [a, b].flatMap((e) => (e.end.kind === "pin" ? [e.end.part] : []));

export type WirePlan = { routes: Route[]; nets: RouteNet[]; obstacles: RouteObstacle[] };
let memo: { sig: string; plan: WirePlan } | null = null;

/** The 2D routes of every jumper (cached on the last input, so "Take it apart" frames reuse it). */
function planRoutes(all: { a: End; b: End; id: string }[], layout: MatLayout): WirePlan {
  const origin = gridOrigin(layout);
  const nets: RouteNet[] = all.map((s, i) => ({
    key: `${s.id}#${i}`,
    a: exitXY(s.a, origin),
    b: exitXY(s.b, origin),
    own: ownParts(s.a, s.b),
    raised: s.a.hole || s.b.hole,
  }));
  const obstacles: RouteObstacle[] = layout.placements.map((p) => ({ id: p.instanceId, box: boxOf(p), soft: p.breadboard }));
  const bb = layout.breadboard;
  const raised: Box | null = bb ? { x: bb.pos[0], y: bb.pos[1], w: bb.w, d: bb.d } : null;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const sig = JSON.stringify([
    nets.map((n) => [n.key, n.a.map(r3), n.b.map(r3), n.own, n.raised]),
    obstacles.map((o) => [o.id, o.soft, r3(o.box.x), r3(o.box.y), r3(o.box.w), r3(o.box.d)]),
    raised,
    origin.map(r3),
  ]);
  if (memo?.sig === sig) return memo.plan;
  const routes = routeWires(nets, obstacles, { origin, raised, inflate: ROUTE_CLEAR });
  const plan = { routes, nets, obstacles };
  memo = { sig, plan };
  return plan;
}

/** Route the whole circuit and return the 2D plan (tests: lanes, clearances, crossings). */
export function planWires(input: Omit<WireInput, "lift" | "only">): WirePlan {
  buildWires(input);
  return memo!.plan;
}

// ── 3D: the floor a wire lies on ───────────────────────────────────────────

type Floor = { z: number; box: Box | null };
type FloorCtx = {
  origin: XY;
  bb: Box | null;
  bbTop: number;
  plugged: { box: Box; top: number }[];
  /** Height a wire rides at over a part it starts / ends on (lift included). */
  level: Map<string, { box: Box; z: number }>;
};

function floorContext(layout: MatLayout, getPart: (id: string) => LibraryPart | undefined, lift?: (id: string) => number): FloorCtx {
  const bb = layout.breadboard;
  const level = new Map<string, { box: Box; z: number }>();
  for (const p of layout.placements) {
    if (p.breadboard) continue;
    const part = getPart(p.partId);
    const pins = part ? Object.values(pins3dFor(part)) : [];
    const ups = pins.filter((q) => isUp(q.dir)).map((q) => pinWorld(p, q).pos[2]);
    const top = ups.length ? Math.max(...ups) : p.pos[2] + p.h;
    level.set(p.instanceId, { box: boxOf(p), z: top + WIRE_R + 0.6 + (lift?.(p.instanceId) ?? 0) });
  }
  return {
    origin: gridOrigin(layout),
    bb: bb ? { x: bb.pos[0], y: bb.pos[1], w: bb.w, d: bb.d } : null,
    bbTop: bb ? bb.h : 0,
    plugged: layout.placements
      .filter((p) => p.breadboard)
      .map((p) => ({ box: { ...boxOf(p), w: p.w + 0.6, d: p.d + 0.6 }, top: p.pos[2] + p.h })),
    level,
  };
}

const inside = (b: Box, x: number, y: number) => Math.abs(x - b.x) <= b.w / 2 + 1e-6 && Math.abs(y - b.y) <= b.d / 2 + 1e-6;

function floorAt(ctx: FloorCtx, own: string[], x: number, y: number): Floor {
  let f: Floor = { z: WIRE_R, box: null };
  if (ctx.bb && inside(ctx.bb, x, y)) f = { z: ctx.bbTop + WIRE_R, box: ctx.bb };
  for (const p of ctx.plugged) if (p.top + WIRE_R > f.z && inside(p.box, x, y)) f = { z: p.top + WIRE_R, box: p.box };
  for (const id of own) {
    const l = ctx.level.get(id);
    if (l && l.z > f.z && inside(l.box, x, y)) f = { z: l.z, box: l.box };
  }
  return f;
}

// ── 3D: the centre line ────────────────────────────────────────────────────

/** Riser out of an end: the pin / hole, up (or out and down) to where the flat run starts. */
function endChain(e: End, node: XY, ctx: FloorCtx, own: string[]): Vec3[] {
  const p = e.pt.pos;
  const out: Vec3[] = [p];
  if (e.hole || isUp(e.pt.dir)) {
    const z = Math.max(floorAt(ctx, own, p[0], p[1]).z, p[2] + WIRE_R + 0.6);
    out.push([p[0], p[1], z]);
  } else {
    const ex = exitXY(e, ctx.origin);
    out.push([ex[0], ex[1], p[2]]);
    const z = floorAt(ctx, own, ex[0], ex[1]).z;
    if (Math.abs(z - p[2]) > 1e-6) out.push([ex[0], ex[1], z]);
  }
  const last = out[out.length - 1];
  if (Math.hypot(node[0] - last[0], node[1] - last[1]) > 1e-6) out.push([node[0], node[1], last[2]]);
  return out;
}

/** The flat run with its steps (onto / off a raised floor) and hops (over earlier wires). */
function runPoints(route: Route, ctx: FloorCtx, own: string[], z0: number, z1: number): Vec3[] {
  const pts = route.points;
  const out: Vec3[] = [];
  const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const crossKey = new Set(route.crossings.map((c) => key(c[0], c[1])));
  // The run starts / ends at the height its riser reached (a header wire rides over its own part).
  const floor = (x: number, y: number, s: number, t: number, len: number): Floor => {
    const f = floorAt(ctx, own, x, y);
    if (s === 0 && t < 1e-6) return { z: z0, box: f.box };
    if (s === pts.length - 2 && t > len - 1e-6) return { z: z1, box: f.box };
    return f;
  };
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, ay] = pts[s];
    const [bx, by] = pts[s + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / (len || 1);
    const uy = (by - ay) / (len || 1);
    const at = (t: number, z: number): Vec3 => [ax + ux * t, ay + uy * t, z];
    const n = Math.round(len / LANE_GAP);
    let prev = floor(ax, ay, s, 0, len);
    if (s === 0) out.push(at(0, prev.z));
    let lastT = 0;
    let k = 1;
    while (k <= n) {
      const t = Math.min(len, k * LANE_GAP);
      const x = ax + ux * t;
      const y = ay + uy * t;
      const f = floor(x, y, s, t, len);
      if (Math.abs(f.z - prev.z) > 1e-6) {
        // A step at the edge of the higher floor, one wire radius outside it (the wire hugs the edge).
        const hi = f.z > prev.z ? f : prev;
        let st = (k - 0.5) * LANE_GAP;
        if (hi.box) {
          const b = hi.box;
          const edges = (Math.abs(ux) > 0.5 ? [b.x - b.w / 2, b.x + b.w / 2].map((v) => (v - ax) * Math.sign(ux)) : [b.y - b.d / 2, b.y + b.d / 2].map((v) => (v - ay) * Math.sign(uy))).sort((p, q) => p - q);
          st = f.z > prev.z ? edges[0] - WIRE_R : edges[1] + WIRE_R;
        }
        st = Math.max(lastT, (k - 1) * LANE_GAP, Math.min(t, st));
        out.push(at(st, prev.z), at(st, f.z));
        lastT = st;
        prev = f;
      }
      if (k < n && crossKey.has(key(x, y))) {
        let m = k;
        while (m + 1 < n && crossKey.has(key(ax + ux * (m + 1) * LANE_GAP, ay + uy * (m + 1) * LANE_GAP))) m++;
        const t0 = Math.max(lastT + 0.2, k * LANE_GAP - 3);
        const t1 = Math.min(len - 0.2, m * LANE_GAP + 3);
        const z = f.z;
        out.push(at(t0, z), at(Math.max(t0, k * LANE_GAP - 1.2), z + HOP), at(Math.min(t1, m * LANE_GAP + 1.2), z + HOP), at(t1, z));
        lastT = t1;
        k = m + 1;
        continue;
      }
      k++;
    }
    out.push(at(len, floor(bx, by, s, len, len).z));
  }
  if (!out.length) out.push([pts[0][0], pts[0][1], z0]);
  return out;
}

function wirePoints(a: End, b: End, route: Route, ctx: FloorCtx): Vec3[] {
  const own = ownParts(a, b);
  const start = endChain(a, route.nodes[0], ctx, own);
  const end = endChain(b, route.nodes[1], ctx, own).reverse();
  const run = runPoints(route, ctx, own, start[start.length - 1][2], end[0][2]);
  return roundCorners(dedupe([...start, ...run, ...end]));
}

/** Drop repeated points and the middle points of straight runs. */
function dedupe(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const cr = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    if (cr < 1e-9 * Math.hypot(...u) * Math.hypot(...v) + 1e-12 && dot > 0) out.splice(i, 1);
  }
  return out;
}

/** Rounds every corner with a small arc (BEND_R between flat runs, STEP_R on steps and risers). The ends stay put. */
export function roundCorners(pts: Vec3[], samples = 5): Vec3[] {
  if (pts.length < 3) return pts;
  const out: Vec3[] = [pts[0]];
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]));
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, v, b] = [pts[i - 1], pts[i], pts[i + 1]];
    const flat = Math.abs(a[2] - v[2]) < 1e-6 && Math.abs(b[2] - v[2]) < 1e-6;
    // The first / last segment is a riser: its corner takes at most a third of it.
    const la = i === 1 ? lens[0] * 0.66 : lens[i - 1] / 2;
    const lb = i === pts.length - 2 ? lens[i] * 0.66 : lens[i] / 2;
    const r = Math.min(flat ? BEND_R : STEP_R, la, lb);
    if (r < 1e-3) {
      out.push(v);
      continue;
    }
    const ua = [(a[0] - v[0]) / lens[i - 1], (a[1] - v[1]) / lens[i - 1], (a[2] - v[2]) / lens[i - 1]];
    const ub = [(b[0] - v[0]) / lens[i], (b[1] - v[1]) / lens[i], (b[2] - v[2]) / lens[i]];
    const p0: Vec3 = [v[0] + ua[0] * r, v[1] + ua[1] * r, v[2] + ua[2] * r];
    const p2: Vec3 = [v[0] + ub[0] * r, v[1] + ub[1] * r, v[2] + ub[2] * r];
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * (1 - t) * t;
      const w2 = t * t;
      out.push([p0[0] * w0 + v[0] * w1 + p2[0] * w2, p0[1] * w0 + v[1] * w1 + p2[1] * w2, p0[2] * w0 + v[2] * w1 + p2[2] * w2]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
