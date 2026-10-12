// 3D wiring (P5-17f): a deterministic orthogonal (Manhattan) router on the mat.
//
// Pure, no three.js. Wires are laid out the way a tidy Fritzing breadboard
// picture draws them: straight runs with right-angle turns, never through a
// part, parallel wires in a shared channel exactly one lane apart (a ribbon),
// as few crossings as possible.
//
// Method: A* on a square grid in the mat plane (pitch = the breadboard's
// 2.54 mm, aligned with its columns and terminal rows), state = (cell, heading).
//   * hard obstacles (parts lying on the mat, inflated by a clearance) are
//     closed, except the wire's OWN end parts (it may run over them to leave
//     a header, at a small extra cost);
//   * soft obstacles (parts plugged into the breadboard) cost a lot, so wires
//     go round them and drape over one only when there is no other way;
//   * the raised region (the breadboard top) costs a little for wires that do
//     not end on it, and climbing on / off it costs a step;
//   * every turn costs; running right next to an earlier wire in the same
//     direction is a little cheaper (bundles form);
//   * a cell an earlier wire runs straight through may be CROSSED at a right
//     angle (cost; the later wire hops over it in 3D), never followed and never
//     turned in; a cell where an earlier wire turns, starts or ends is closed.
// Because no two wires share a cell along the same axis, two parallel wires
// are always at least one grid pitch (= LANE_GAP) apart.
// Wires are routed shortest first (then by key), so the result is the same
// for the same input.

export type XY = [number, number];
/** Axis-aligned box: centre + size (mm). */
export type Box = { x: number; y: number; w: number; d: number };

export type RouteObstacle = { id: string; box: Box; soft?: boolean };

export type RouteNet = {
  key: string;
  a: XY;
  b: XY;
  /** Obstacles this wire may run over (the parts it starts / ends on). */
  own?: string[];
  /** The wire starts or ends on the raised region (the breadboard). */
  raised?: boolean;
};

export type RouteOptions = {
  /** Grid pitch (mm). */
  pitch?: number;
  /** A point on the grid (mm). */
  origin?: XY;
  /** Clearance kept around hard obstacles (mm). */
  inflate?: number;
  /** The raised floor (the breadboard top), or none. */
  raised?: Box | null;
  /** Free space around everything (mm). */
  margin?: number;
};

export type Route = {
  key: string;
  /** Grid nodes the wire starts and ends on (snapped from a / b). */
  nodes: [XY, XY];
  /** Corner points of the run, nodes[0] … nodes[1] (axis-aligned segments). */
  points: XY[];
  /** Cells where this wire crosses an earlier one at a right angle (it hops there). */
  crossings: XY[];
  /** False when no path existed (the run is then a plain L, obstacles ignored). */
  ok: boolean;
};

/** Grid pitch = the distance between two parallel wires in a bundle (mm). */
export const LANE_GAP = 2.54;
/** Clearance kept between a wire and a part it does not belong to (mm). */
export const ROUTE_CLEAR = 2;

const STEP = 1;
const TURN = 2.5;
const CROSS = 10;
const OWN = 5;
const SOFT = 18;
const RAISED_FOREIGN = 1.2;
const EDGE = 3;
const HUG = 0.3;
/** Heuristic weight: a touch greedy (≥ the cheapest step) keeps the search small. */
const H_SCALE = STEP * 1.2;

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

const inBox = (b: Box, x: number, y: number, pad: number) =>
  Math.abs(x - b.x) <= b.w / 2 + pad + 1e-9 && Math.abs(y - b.y) <= b.d / 2 + pad + 1e-9;

/** The grid node nearest to p (pitch, origin). */
export function snapXY(p: XY, origin: XY = [0, 0], pitch = LANE_GAP): XY {
  return [origin[0] + Math.round((p[0] - origin[0]) / pitch) * pitch, origin[1] + Math.round((p[1] - origin[1]) / pitch) * pitch];
}

/** Binary min-heap on (f, insertion order) — deterministic, no allocation per operation. */
class Heap {
  private f = new Float64Array(1024);
  private s = new Int32Array(1024);
  private o = new Float64Array(1024);
  private n = 0;
  private seq = 0;
  get size() {
    return this.n;
  }
  clear() {
    this.n = 0;
  }
  private grow() {
    const f = new Float64Array(this.f.length * 2);
    const s = new Int32Array(this.s.length * 2);
    const o = new Float64Array(this.o.length * 2);
    f.set(this.f);
    s.set(this.s);
    o.set(this.o);
    this.f = f;
    this.s = s;
    this.o = o;
  }
  push(fv: number, sv: number) {
    if (this.n === this.f.length) this.grow();
    const f = this.f;
    const s = this.s;
    const o = this.o;
    const ov = this.seq++;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[p] < fv || (f[p] === fv && o[p] < ov)) break;
      f[i] = f[p];
      s[i] = s[p];
      o[i] = o[p];
      i = p;
    }
    f[i] = fv;
    s[i] = sv;
    o[i] = ov;
  }
  pop(): number {
    const f = this.f;
    const s = this.s;
    const o = this.o;
    const top = s[0];
    const n = --this.n;
    const fv = f[n];
    const sv = s[n];
    const ov = o[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= n) break;
      const r = l + 1;
      let m = l;
      if (r < n && (f[r] < f[l] || (f[r] === f[l] && o[r] < o[l]))) m = r;
      if (fv < f[m] || (fv === f[m] && ov < o[m])) break;
      f[i] = f[m];
      s[i] = s[m];
      o[i] = o[m];
      i = m;
    }
    f[i] = fv;
    s[i] = sv;
    o[i] = ov;
    return top;
  }
}

/** Route every net. Results come back in input order. Same input → same output. */
export function routeWires(nets: RouteNet[], obstacles: RouteObstacle[], opts: RouteOptions = {}): Route[] {
  const P = opts.pitch ?? LANE_GAP;
  const origin = opts.origin ?? [0, 0];
  const inflate = opts.inflate ?? ROUTE_CLEAR;
  const margin = opts.margin ?? 24;
  const raised = opts.raised ?? null;
  if (!nets.length) return [];

  // ── Grid extent ──
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const n of nets) {
    grow(n.a[0], n.a[1]);
    grow(n.b[0], n.b[1]);
  }
  for (const o of obstacles) {
    grow(o.box.x - o.box.w / 2, o.box.y - o.box.d / 2);
    grow(o.box.x + o.box.w / 2, o.box.y + o.box.d / 2);
  }
  if (raised) {
    grow(raised.x - raised.w / 2, raised.y - raised.d / 2);
    grow(raised.x + raised.w / 2, raised.y + raised.d / 2);
  }
  const i0 = Math.floor((minX - margin - origin[0]) / P);
  const j0 = Math.floor((minY - margin - origin[1]) / P);
  const W = Math.ceil((maxX + margin - origin[0]) / P) - i0 + 1;
  const H = Math.ceil((maxY + margin - origin[1]) / P) - j0 + 1;
  const N = W * H;
  const cx = (n: number) => origin[0] + (i0 + (n % W)) * P;
  const cy = (n: number) => origin[1] + (j0 + Math.floor(n / W)) * P;
  const cellOf = (p: XY) => {
    const i = Math.round((p[0] - origin[0]) / P) - i0;
    const j = Math.round((p[1] - origin[1]) / P) - j0;
    return Math.max(0, Math.min(H - 1, j)) * W + Math.max(0, Math.min(W - 1, i));
  };

  // ── Static cost layers ──
  const hard = new Int32Array(N); // obstacle index + 1
  const soft = new Uint8Array(N);
  const up = new Uint8Array(N);
  obstacles.forEach((o, k) => {
    const pad = o.soft ? 0.6 : inflate;
    const ia = Math.max(0, Math.floor((o.box.x - o.box.w / 2 - pad - origin[0]) / P) - i0);
    const ib = Math.min(W - 1, Math.ceil((o.box.x + o.box.w / 2 + pad - origin[0]) / P) - i0);
    const ja = Math.max(0, Math.floor((o.box.y - o.box.d / 2 - pad - origin[1]) / P) - j0);
    const jb = Math.min(H - 1, Math.ceil((o.box.y + o.box.d / 2 + pad - origin[1]) / P) - j0);
    for (let j = ja; j <= jb; j++)
      for (let i = ia; i <= ib; i++) {
        const n = j * W + i;
        if (!inBox(o.box, cx(n), cy(n), pad)) continue;
        if (o.soft) soft[n] = 1;
        else if (!hard[n]) hard[n] = k + 1;
      }
  });
  if (raised) for (let n = 0; n < N; n++) if (inBox(raised, cx(n), cy(n), 0)) up[n] = 1;
  const obstacleIndex = new Map(obstacles.map((o, k) => [o.id, k]));

  // ── End nodes: snapped; two different ends never share a node (the same point may) ──
  const endKey = (p: XY) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const nodeOfKey = new Map<string, number>();
  const nodeOwner = new Map<number, string>();
  const order = nets
    .map((n, i) => ({ n, i, len: Math.abs(n.a[0] - n.b[0]) + Math.abs(n.a[1] - n.b[1]) }))
    .sort((p, q) => p.len - q.len || (p.n.key < q.n.key ? -1 : p.n.key > q.n.key ? 1 : p.i - q.i));
  const claim = (p: XY, ownHard: Set<number>): number => {
    const k = endKey(p);
    const have = nodeOfKey.get(k);
    if (have !== undefined) return have;
    const c0 = cellOf(p);
    const i = c0 % W;
    const j = Math.floor(c0 / W);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < 6 && best < 0; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const n = jj * W + ii;
          if (nodeOwner.has(n)) continue;
          if (hard[n] && !ownHard.has(hard[n] - 1)) continue;
          const d = Math.hypot(cx(n) - p[0], cy(n) - p[1]);
          if (d < bestD - 1e-9) {
            bestD = d;
            best = n;
          }
        }
    if (best < 0) best = c0;
    nodeOfKey.set(k, best);
    nodeOwner.set(best, k);
    return best;
  };
  const ownOf = (n: RouteNet) => new Set((n.own ?? []).map((id) => obstacleIndex.get(id)).filter((x): x is number => x !== undefined));
  const ends = new Map<number, [number, number]>();
  for (const { n, i } of order) {
    const own = ownOf(n);
    ends.set(i, [claim(n.a, own), claim(n.b, own)]);
  }
  const endNode = new Uint8Array(N);
  for (const n of nodeOwner.keys()) endNode[n] = 1;

  // ── Dynamic layers (routed wires) ──
  const occX = new Int32Array(N);
  const occY = new Int32Array(N);
  /** Cells where a wire turns (wire index + 1): nobody else may enter them. */
  const bend = new Int32Array(N);

  const S = N * 4;
  const g = new Float64Array(S);
  const from = new Int32Array(S);
  // Generation stamps instead of clearing the arrays for every search.
  const seen = new Int32Array(S);
  const shut = new Int32Array(S);
  let gen = 0;
  const heap = new Heap();

  type Path = { cells: number[]; heads: number[] };
  const paths: (Path | null)[] = nets.map(() => null);
  /** When each wire was last laid (of two crossing wires, the later one hops). */
  const stamp = new Int32Array(nets.length);
  let clock = 0;

  let crossCost = CROSS;
  const search = (idx: number, capped = false): Path | null => {
    const net = nets[idx];
    const [sa, sb] = ends.get(idx)!;
    const own = ownOf(net);
    const keyA = endKey(net.a);
    const keyB = endKey(net.b);
    gen++;
    heap.clear();
    const gi = sb % W;
    const gj = Math.floor(sb / W);
    const h = (c: number) => (Math.abs((c % W) - gi) + Math.abs(Math.floor(c / W) - gj)) * H_SCALE;
    for (let d = 0; d < 4; d++) {
      g[sa * 4 + d] = 0;
      from[sa * 4 + d] = -1;
      seen[sa * 4 + d] = gen;
      heap.push(h(sa), sa * 4 + d);
    }
    let goal = -1;
    // A re-route (rip-up pass) gets a bounded search (deterministic: counted, not timed); the old path stays when it runs out.
    const cap = capped ? 4000 + 40 * h(sa) : Infinity;
    let expanded = 0;
    while (heap.size) {
      const st = heap.pop();
      if (shut[st] === gen) continue;
      shut[st] = gen;
      if (++expanded > cap) break;
      const c = st >> 2;
      const d = st & 3;
      if (c === sb) {
        goal = st;
        break;
      }
      // Entered across another wire: go straight on.
      const crossing = c !== sa && (d & 1 ? occX[c] : occY[c]) !== 0;
      const ci = c % W;
      const cj = Math.floor(c / W);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3) && c !== sa) continue;
        if (crossing && nd !== d) continue;
        const ii = ci + DX[nd];
        const jj = cj + DY[nd];
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const m = jj * W + ii;
        const isGoal = m === sb;
        if (!isGoal) {
          if (bend[m] && bend[m] !== idx + 1) continue;
          if (endNode[m]) {
            const k = nodeOwner.get(m);
            if (k !== keyA && k !== keyB) continue;
          }
          if (hard[m] && !own.has(hard[m] - 1)) continue;
        }
        const along = nd & 1 ? occY[m] : occX[m];
        const across = nd & 1 ? occX[m] : occY[m];
        if (along) continue;
        if (across && isGoal) continue;
        let cost = STEP;
        if (nd !== d && c !== sa) cost += TURN;
        if (across) cost += crossCost;
        if (hard[m]) cost += OWN;
        if (soft[m] && !isGoal) cost += SOFT;
        if (up[m] && !net.raised) cost += RAISED_FOREIGN;
        if (up[m] !== up[c]) cost += EDGE;
        // Hugging another wire that runs the same way.
        const pi = nd & 1 ? 1 : 0;
        const pj = nd & 1 ? 0 : 1;
        const occ = nd & 1 ? occY : occX;
        const q1i = ii - pi;
        const q1j = jj - pj;
        const q2i = ii + pi;
        const q2j = jj + pj;
        if ((q1i >= 0 && q1j >= 0 && occ[q1j * W + q1i]) || (q2i < W && q2j < H && occ[q2j * W + q2i])) cost -= HUG;
        const ns = m * 4 + nd;
        const ng = g[st] + cost;
        if (ng < (seen[ns] === gen ? g[ns] : Infinity) - 1e-9) {
          g[ns] = ng;
          seen[ns] = gen;
          from[ns] = st;
          heap.push(ng + h(m), ns);
        }
      }
    }
    if (goal < 0) return null;
    const cells: number[] = [];
    const heads: number[] = [];
    for (let st = goal; st >= 0; st = from[st]) {
      cells.push(st >> 2);
      heads.push(st & 3);
      if (from[st] < 0) break;
    }
    cells.reverse();
    heads.reverse();
    return { cells, heads };
  };

  /** Lay (on = true) or lift a wire's cells. */
  const mark = (idx: number, p: Path, on: boolean) => {
    const v = on ? idx + 1 : 0;
    const last = p.cells.length - 1;
    for (let k = 1; k < last; k++) {
      const c = p.cells[k];
      const din = p.heads[k];
      const dout = p.heads[k + 1];
      if (din !== dout) {
        bend[c] = v;
        occX[c] = v;
        occY[c] = v;
      } else if (din & 1) occY[c] = v;
      else occX[c] = v;
    }
  };
  /** How many cells of this path cross another wire. */
  const crossesOf = (idx: number, p: Path) => {
    let n = 0;
    for (let k = 1; k < p.cells.length - 1; k++) {
      const c = p.cells[k];
      if (p.heads[k] !== p.heads[k + 1]) continue;
      const other = p.heads[k] & 1 ? occX[c] : occY[c];
      if (other && other !== idx + 1) n++;
    }
    return n;
  };

  for (const { i } of order) {
    const [sa, sb] = ends.get(i)!;
    if (sa === sb) continue;
    const p = search(i);
    paths[i] = p;
    if (p) {
      mark(i, p, true);
      stamp[i] = ++clock;
    }
  }
  // Rip up and re-route the wires that cross others, now that every wire is on the mat.
  // Each pass makes a crossing dearer, so a wire that still crosses looks harder for a way round.
  for (let pass = 0; pass < 4; pass++) {
    crossCost = CROSS * (1 + pass * 0.5);
    const todo = order
      .map(({ i }) => ({ i, x: paths[i] ? crossesOf(i, paths[i]!) : 0 }))
      .filter((t) => t.x > 0)
      .sort((a, b) => b.x - a.x || a.i - b.i);
    if (!todo.length) break;
    for (const { i } of todo) {
      const old = paths[i]!;
      if (crossesOf(i, old) === 0) continue;
      mark(i, old, false);
      const p = search(i, true);
      const use = p ?? old;
      paths[i] = use;
      mark(i, use, true);
      stamp[i] = ++clock;
    }
  }

  return nets.map((net, idx) => {
    const [sa, sb] = ends.get(idx)!;
    const nodes: [XY, XY] = [
      [cx(sa), cy(sa)],
      [cx(sb), cy(sb)],
    ];
    const p = paths[idx];
    if (sa === sb) return { key: net.key, nodes, points: [nodes[0], nodes[1]], crossings: [], ok: true };
    if (!p) {
      // No way through: a plain L (obstacles ignored), marked so tests and the view can tell.
      return { key: net.key, nodes, points: [nodes[0], [nodes[1][0], nodes[0][1]], nodes[1]], crossings: [], ok: false };
    }
    const pts: XY[] = [nodes[0]];
    const crossings: XY[] = [];
    for (let k = 1; k < p.cells.length; k++) {
      const c = p.cells[k];
      const last = k === p.cells.length - 1;
      if (last || p.heads[k] !== p.heads[k + 1]) {
        pts.push([cx(c), cy(c)]);
        continue;
      }
      // Crossing: the wire laid later hops over the other one.
      const other = p.heads[k] & 1 ? occX[c] : occY[c];
      if (other && other !== idx + 1 && stamp[idx] > stamp[other - 1]) crossings.push([cx(c), cy(c)]);
    }
    return { key: net.key, nodes, points: pts, crossings, ok: true };
  });
}

/** Total crossings in a routed set (a crossing is counted once, on the wire that hops). */
export const crossingCount = (routes: Route[]) => routes.reduce((t, r) => t + r.crossings.length, 0);
