// "Wiring" tab drawing (P5-17), Fritzing style: flat drawings of the real
// boards and modules, every pin labelled, joined by smooth coloured wires.
//
// One source of truth: the wires are the Connection[] of lib/studio/connections.ts
// (same ids, same colours as the 3D view, the schematic and the pin list).
//
// Layout (deterministic, no randomness):
//   * the main board in the middle; every other part in a column on the side
//     its wires go (layer 1 touches the board, layer 2 hangs off those, e.g. the
//     pump behind its driver, the LED behind its resistor);
//   * each part is turned so the edge with most pins faces the board; pins sit on
//     the left / right edges, labels INSIDE the body, so a wire leaves its pin
//     sideways without crossing any text;
//   * wires are cubic Béziers that leave each pin perpendicular to its header;
//     wires that cannot face each other arch over the top / under the bottom;
//   * a pin that feeds three or more parts (3V3, GND…) gets a breadboard rail:
//     one trunk wire to the rail, short taps from it to each part;
//   * a series helper (resistor) sits on a little breadboard strip between the
//     board and its host; both segments of that wire carry the same id.
//
// Every wire path has data-conn="<connection id>" and data-colour; every pin dot
// has data-pin="<instance>.<pin>" and its label data-pin-label. All text is escaped.
// The drawing is always left-to-right (direction="ltr"), also in Arabic.

import { esc } from "@/lib/prototyping/netlist";
import {
  buildConnections,
  instanceNames,
  partName,
  pinLabel,
  WIRE_HEX,
  WIRE_OUTLINE,
  type Connection,
  type WireColour,
} from "./connections";
import { drawing2d, PITCH_MM, type Decor, type Drawing2D, type Edge } from "./drawing2d";
import { isMcu, isServoDriver, openByDesign, type GetPart, type Locale } from "./netlist";
import type { LibraryPart, Net, StudioComponent } from "./schema";

export type WiringDrawingOpts = { locale: Locale; connections?: Connection[] };

// ── Look ────────────────────────────────────────────────────────────────────

const INK = "#1c2434";
const MUTED = "#64748b";
const PAPER = "#ffffff";
const SANS = "Outfit, system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const BREAD = "#efe6cf";
const BREAD_LINE = "#cdbf97";
const BREAD_HOLE = "#a99a6c";

const S = 16 / PITCH_MM; // px per mm: one header pitch = 16 px
const PITCH = 16;
const PIN_FONT = 13;
const NAME_FONT = 15;
const CW = 7.9; // mono 13 px glyph width
const PIN_R = 5;
const PAD = 28;
const WIRE_W = 4;

const f = (n: number) => String(Math.round(n * 10) / 10);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── Types ───────────────────────────────────────────────────────────────────

type DrawnPin = { id: string; ref: string; edge: Edge; x: number; y: number; label: string };

type Inst = {
  id: string;
  part: LibraryPart;
  d: Drawing2D;
  name: string;
  w: number;
  h: number;
  axial: boolean;
  flip: boolean;
  /** -1 left of the board, 1 right, 0 the board itself. */
  side: -1 | 0 | 1;
  layer: number;
  x: number;
  y: number;
  pins: DrawnPin[];
  byPin: Map<string, DrawnPin>;
  /** Free area inside the body (no labels), local px. */
  free: { x0: number; x1: number };
};

type Pt = { x: number; y: number };

// ── Sizing a part ───────────────────────────────────────────────────────────

function makeInst(c: StudioComponent, part: LibraryPart, name: string, wired: ReadonlySet<string>): Inst {
  const full = drawing2d(part);
  // A servo driver's open channels and OE are not drawn (16 channels × 3 pins would bury the used ones).
  const shown = (id: string) => {
    const pin = part.pins.find((p) => p.id === id);
    return !pin || !openByDesign(part, pin) || wired.has(`${c.instanceId}.${id}`);
  };
  const d: Drawing2D = full.pins.every((p) => shown(p.id)) ? full : { ...full, pins: full.pins.filter((p) => shown(p.id)) };
  const axial = d.decor === "resistor";
  const labelOf = (pinId: string) => {
    const pin = part.pins.find((p) => p.id === pinId)!;
    return pinLabel(part, pin);
  };
  const edges: Record<Edge, string[]> = { left: [], right: [] };
  for (const p of d.pins) edges[p.edge].push(p.id);
  const labW = (e: Edge) => Math.max(0, ...edges[e].map((id) => labelOf(id).length * CW));
  const lw = edges.left.length ? labW("left") + 14 : 0;
  const rw = edges.right.length ? labW("right") + 14 : 0;

  let w: number;
  let h: number;
  if (axial) {
    w = 124;
    h = 26;
  } else {
    const need = lw + rw + (lw && rw ? 18 : 24);
    w = Math.ceil(Math.max(56, need, Math.min(d.w * S, 240)));
    const most = Math.max(edges.left.length, edges.right.length, 1);
    h = Math.ceil(Math.max((most - 1) * PITCH + 40, 44, Math.min(d.h * S, 380)));
  }
  const pins: DrawnPin[] = d.pins.map((p) => {
    const list = edges[p.edge];
    const i = list.indexOf(p.id);
    const y = axial ? h / 2 : (h - (list.length - 1) * PITCH) / 2 + i * PITCH;
    return { id: p.id, ref: `${c.instanceId}.${p.id}`, edge: p.edge, x: p.edge === "left" ? 0 : w, y, label: labelOf(p.id) };
  });
  return {
    id: c.instanceId,
    part,
    d,
    name,
    w,
    h,
    axial,
    flip: false,
    side: 0,
    layer: 0,
    x: 0,
    y: 0,
    pins,
    byPin: new Map(pins.map((p) => [p.id, p])),
    free: { x0: lw || 8, x1: w - (rw || 8) },
  };
}

/** Mirror a part left-right so its pin edge faces the other way. */
function applyFlip(i: Inst, flip: boolean) {
  if (i.flip === flip) return;
  i.flip = flip;
  for (const p of i.pins) {
    p.edge = p.edge === "left" ? "right" : "left";
    p.x = i.w - p.x;
  }
  i.free = { x0: i.w - i.free.x1, x1: i.w - i.free.x0 };
}

const absOf = (i: Inst, p: DrawnPin): Pt => ({ x: i.x + p.x, y: i.y + p.y });
const dirOf = (p: DrawnPin): -1 | 1 => (p.edge === "left" ? -1 : 1);

// ── Wires ───────────────────────────────────────────────────────────────────

/** A cubic that leaves S along dS and arrives at E along dE (both horizontal). */
function curve(S_: Pt, dS: number, E: Pt, dE: number, detourY: number | null): string {
  const facing = dS * (E.x - S_.x) > 24 && dE * (S_.x - E.x) > 24;
  if (facing || detourY === null) {
    const h = clamp(Math.abs(E.x - S_.x) * 0.5, 28, 150);
    return `M${f(S_.x)} ${f(S_.y)}C${f(S_.x + dS * h)} ${f(S_.y)} ${f(E.x + dE * h)} ${f(E.y)} ${f(E.x)} ${f(E.y)}`;
  }
  // Arch over the top / under the bottom through V, horizontal there.
  const vx = (S_.x + E.x) / 2;
  const t = Math.sign(E.x - S_.x) || -dS;
  const L = 64;
  const h = Math.max(70, Math.abs(vx - S_.x) * 0.45);
  return (
    `M${f(S_.x)} ${f(S_.y)}C${f(S_.x + dS * L)} ${f(S_.y)} ${f(vx - t * h)} ${f(detourY)} ${f(vx)} ${f(detourY)}` +
    `C${f(vx + t * h)} ${f(detourY)} ${f(E.x + dE * L)} ${f(E.y)} ${f(E.x)} ${f(E.y)}`
  );
}

const straight = (a: Pt, b: Pt) => {
  const dx = (b.x - a.x) / 3;
  return `M${f(a.x)} ${f(a.y)}C${f(a.x + dx)} ${f(a.y)} ${f(b.x - dx)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`;
};

function wirePaths(d: string, c: Connection, extra = "", strand?: WireColour): string {
  const id = esc(c.id);
  const base = `fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1"`;
  if (strand) {
    // The V+ / GND strand of a servo plug: same id as its signal wire, its own colour.
    return `<path class="wire-strand" data-conn="${id}" data-colour="${strand}"${extra} d="${d}" stroke="${WIRE_HEX[strand]}" stroke-width="${WIRE_W - 1}" ${base}/>`;
  }
  const hex = WIRE_HEX[c.wireColour];
  const outline = WIRE_OUTLINE[c.wireColour];
  let s = "";
  if (outline)
    s += `<path class="wire-casing" data-conn="${id}"${extra} d="${d}" stroke="${outline}" stroke-width="${WIRE_W + 3.4}" ${base}/>`;
  s += `<path class="wire-main" data-conn="${id}" data-colour="${c.wireColour}"${extra} d="${d}" stroke="${hex}" stroke-width="${WIRE_W}" style="color:${hex}" ${base}/>`;
  s += `<path class="wire-hit" data-conn="${id}"${extra} d="${d}" stroke="transparent" stroke-width="16" fill="none" stroke-linecap="round" pathLength="1"/>`;
  return s;
}

// ── Decor ───────────────────────────────────────────────────────────────────

function decorSvg(i: Inst): string {
  const { d } = i;
  const x0 = i.free.x0;
  const x1 = i.free.x1;
  const fw = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cy = i.h / 2;
  const kind: Decor = d.decor;
  if (kind === "none" || fw < 18) return "";
  const line = d.textColour === "#ffffff" ? "rgba(255,255,255,.35)" : "rgba(28,36,52,.35)";
  switch (kind) {
    case "chip": {
      const s = Math.min(fw - 6, i.h * 0.28, 70);
      if (s < 14) return "";
      return `<rect x="${f(cx - s / 2)}" y="${f(cy - s / 2)}" width="${f(s)}" height="${f(s)}" rx="4" fill="rgba(0,0,0,.35)" stroke="${line}" stroke-width="1"/>`;
    }
    case "screen": {
      const w = Math.min(fw - 6, 120);
      const h = Math.min(i.h * 0.4, 60);
      return `<rect x="${f(cx - w / 2)}" y="${f(i.h * 0.2)}" width="${f(w)}" height="${f(h)}" rx="3" fill="#0b1220" stroke="${line}" stroke-width="1"/>`;
    }
    case "led": {
      const r = Math.min(fw / 2 - 3, i.h / 2 - 8, 15);
      if (r < 6) return "";
      const col = d.accent ?? "#ff3b30";
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${esc(col)}" stroke="${INK}" stroke-width="1.2"/><circle cx="${f(cx - r * 0.3)}" cy="${f(cy - r * 0.3)}" r="${f(r * 0.3)}" fill="rgba(255,255,255,.55)"/>`;
    }
    case "ring": {
      const r = Math.min(fw / 2 - 4, i.h / 2 - 8);
      if (r < 10) return "";
      let s = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${line}" stroke-width="1.2"/>`;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        s += `<circle cx="${f(cx + Math.cos(a) * (r - 6))}" cy="${f(cy + Math.sin(a) * (r - 6))}" r="3" fill="#f8fafc"/>`;
      }
      return s;
    }
    default:
      return "";
  }
}

const BAND_DEFAULT = ["#c0392b", "#c0392b", "#6e3b1c", "#c9a227"];

function bodySvg(i: Inst): string {
  const { d } = i;
  if (i.axial) {
    const bx = 24;
    const bw = i.w - 48;
    const bands = (d.bands && d.bands.length ? d.bands : BAND_DEFAULT).slice(0, 4);
    let s =
      `<path d="M0 ${f(i.h / 2)}H${bx} M${f(i.w - bx)} ${f(i.h / 2)}H${f(i.w)}" stroke="#9aa3ad" stroke-width="3" stroke-linecap="round"/>` +
      `<rect x="${bx}" y="2" width="${bw}" height="${i.h - 4}" rx="9" fill="#e9dcb8" stroke="${INK}" stroke-width="1.2"/>`;
    bands.forEach((b, k) => {
      s += `<rect x="${f(bx + 14 + k * 14)}" y="2.6" width="6" height="${i.h - 5.2}" fill="${esc(b)}"/>`;
    });
    return s;
  }
  return `<rect x="0" y="0" width="${i.w}" height="${i.h}" rx="9" fill="${esc(d.colour)}" stroke="${INK}" stroke-width="1.6"/>` + decorSvg(i);
}

// ── Render ──────────────────────────────────────────────────────────────────

const EMPTY_TEXT: Record<Locale, string> = { en: "No parts to draw yet", ar: "لا توجد قطع للرسم بعد" };
const LABEL_TEXT: Record<Locale, string> = { en: "Wiring drawing", ar: "رسم التوصيل" };

export function renderWiringSVG(
  components: StudioComponent[],
  nets: Net[],
  getPart: GetPart,
  opts: WiringDrawingOpts,
): string {
  const { locale } = opts;
  const rtl = locale === "ar" ? ` direction="rtl"` : "";
  const conns = opts.connections ?? buildConnections(components, nets, getPart);
  const ownNames = instanceNames(conns, locale);
  const wired = new Set<string>();
  for (const c of conns) {
    for (const e of [c.from, c.to, ...(c.bundle ?? []).flatMap((b) => [b.from, b.to])]) wired.add(`${e.part}.${e.pin}`);
  }
  const aria = esc(LABEL_TEXT[locale]);
  const open = (w: number, h: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${aria}" font-family="${SANS}" direction="ltr"><title>${aria}</title><rect x="0" y="0" width="${f(w)}" height="${f(h)}" rx="16" fill="${PAPER}"/>`;

  // Instances (names get a number when a part appears twice).
  const total = new Map<string, number>();
  const seen = new Map<string, number>();
  const withPart: { c: StudioComponent; part: LibraryPart }[] = [];
  for (const c of components) {
    const part = getPart(c.partId);
    if (!part) continue;
    withPart.push({ c, part });
    total.set(part.id, (total.get(part.id) ?? 0) + 1);
  }
  const list: Inst[] = withPart.map(({ c, part }) => {
    const n = (seen.get(part.id) ?? 0) + 1;
    seen.set(part.id, n);
    const own = ownNames.get(c.instanceId);
    const base = partName(part, locale, c.label);
    return makeInst(c, part, own ?? ((total.get(part.id) ?? 1) > 1 ? `${base} ${n}` : base), wired);
  });
  if (!list.length) {
    return `${open(320, 120)}<text x="160" y="64" text-anchor="middle" font-size="15" fill="${MUTED}"${rtl}>${esc(EMPTY_TEXT[locale])}</text></svg>`;
  }
  const byId = new Map(list.map((i) => [i.id, i]));
  const hub = list.find((i) => isMcu(i.part)) ?? list[0];

  // Which two pins of a series helper the wire runs through.
  const legs = new Map<string, { a: string; b: string }>();
  for (const c of conns) {
    if (!c.viaPart) continue;
    const h = byId.get(c.viaPart);
    if (!h) continue;
    const net = nets.find((n) => n.name === c.net);
    const a = h.part.pins.find((p) => net?.pins.includes(`${h.id}.${p.id}`))?.id ?? h.part.pins[0]?.id;
    const b = h.part.pins.find((p) => p.id !== a)?.id ?? a;
    if (a && b) legs.set(c.id, { a, b });
  }

  // ── Layers: board 0, its neighbours 1, theirs 2 … (a via host is always behind its helper) ──
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!byId.has(a) || !byId.has(b) || a === b) return;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  };
  const viaHostOf = new Map<string, string>(); // host → helper
  // Supply and ground wires to the board do not decide where a part sits: a pump that
  // only shares the ground rail with the board belongs behind its driver.
  // Nor does the wall supply's feed to a servo driver: the driver sits by the board, its servos behind it.
  const railToHub = (c: Connection) =>
    (c.role === "power" || c.role === "ground") &&
    (c.from.part === hub.id ||
      c.to.part === hub.id ||
      [c.from.part, c.to.part].some((id) => {
        const p = byId.get(id)?.part;
        return !!p && isServoDriver(p);
      }));
  for (const c of conns) {
    if (c.viaPart && byId.has(c.viaPart)) {
      link(c.from.part, c.viaPart);
      link(c.viaPart, c.to.part);
      viaHostOf.set(c.to.part, c.viaPart);
    } else if (!railToHub(c)) link(c.from.part, c.to.part);
  }
  const parent = new Map<string, string>();
  hub.layer = 0;
  const queue = [hub.id];
  const done = new Set([hub.id]);
  for (let q = 0; q < queue.length; q++) {
    const cur = byId.get(queue[q])!;
    for (const nb of adj.get(cur.id) ?? []) {
      if (done.has(nb)) continue;
      done.add(nb);
      const n = byId.get(nb)!;
      n.layer = cur.layer + 1;
      parent.set(nb, cur.id);
      queue.push(nb);
    }
  }
  for (const i of list) {
    if (i === hub) continue;
    if (!done.has(i.id)) {
      i.layer = 1;
      parent.set(i.id, hub.id);
    }
    const helper = viaHostOf.get(i.id);
    if (helper && i.layer < 2) {
      i.layer = (byId.get(helper)?.layer ?? 1) + 1;
      parent.set(i.id, helper);
    }
  }

  // ── Sides ──
  const connsOf = (id: string) => conns.filter((c) => c.from.part === id || c.to.part === id || c.viaPart === id);
  const hubPinOf = (c: Connection): string | null => (c.from.part === hub.id ? c.from.pin : c.to.part === hub.id ? c.to.pin : null);
  const score = new Map<string, number>();
  for (const i of list) {
    if (i === hub || i.layer !== 1) continue;
    let s = 0;
    for (const c of connsOf(i.id)) {
      const pin = hubPinOf(c);
      const p = pin ? hub.byPin.get(pin) : undefined;
      // Signals decide the side; supply and ground follow (they can arch over the board).
      if (p) s += dirOf(p) * (c.role === "power" || c.role === "ground" ? 1 : 3);
    }
    score.set(i.id, s);
  }
  let nL = 0;
  let nR = 0;
  for (const i of list) {
    if (i === hub || i.layer !== 1) continue;
    const s = score.get(i.id) ?? 0;
    if (s !== 0) {
      i.side = s < 0 ? -1 : 1;
      if (i.side < 0) nL++;
      else nR++;
    }
  }
  for (const i of list) {
    if (i === hub || i.layer !== 1 || i.side !== 0) continue;
    i.side = nR <= nL ? 1 : -1;
    if (i.side < 0) nL++;
    else nR++;
  }
  for (let k = 2; k <= Math.max(...list.map((i) => i.layer)); k++) {
    for (const i of list) {
      if (i.layer !== k) continue;
      i.side = byId.get(parent.get(i.id) ?? hub.id)?.side || 1;
    }
  }

  // ── Flip so the busy edge faces the board ──
  for (const i of list) {
    if (i === hub) continue;
    const need: Edge = i.side < 0 ? "right" : "left";
    const helperConn = i.axial ? conns.find((c) => c.viaPart === i.id) : undefined;
    const legA = helperConn ? legs.get(helperConn.id)?.a : undefined;
    const aEdge = legA ? i.byPin.get(legA)?.edge : undefined;
    // A servo driver faces the board with its I2C side; its channel side faces its servos.
    const i2cEdge = isServoDriver(i.part) ? i.pins.find((p) => /^(SDA|SCL)$/.test(p.id))?.edge : undefined;
    const facing = aEdge ?? i2cEdge ?? i.d.dominant;
    applyFlip(i, facing !== need);
  }

  // ── Rails (a hub pin feeding three or more parts) ──
  type Rail = { key: string; conns: Connection[]; taps: Connection[]; side: -1 | 1; index: number; x: number; y1: number; y2: number };
  const rails: Rail[] = [];
  {
    const groups = new Map<string, Connection[]>();
    for (const c of conns) {
      if (c.viaPart || c.from.part !== hub.id) continue;
      const k = `${c.from.part}.${c.from.pin}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    const perSide: Record<string, number> = { "-1": 0, "1": 0 };
    for (const [key, cs] of groups) {
      if (cs.length < 3) continue;
      const p = hub.byPin.get(cs[0].from.pin);
      if (!p) continue;
      const side = dirOf(p);
      const taps = cs.filter((c) => {
        const t = byId.get(c.to.part);
        return t && t.side === side;
      });
      if (taps.length < 2) continue;
      rails.push({ key, conns: cs, taps, side, index: perSide[String(side)]++, x: 0, y1: 0, y2: 0 });
    }
  }
  const railsOn = (s: number) => rails.filter((r) => r.side === s).length;

  // ── Columns: x ──
  hub.x = 0;
  hub.y = 0;
  for (const side of [-1, 1] as const) {
    const layers = [...new Set(list.filter((i) => i.side === side).map((i) => i.layer))].sort((a, b) => a - b);
    let cursor = side > 0 ? hub.w : 0;
    for (const L of layers) {
      const col = list.filter((i) => i.side === side && i.layer === L);
      const gap = L === 1 ? 96 + 46 * railsOn(side) : 84;
      const colW = Math.max(...col.map((i) => i.w));
      if (side > 0) {
        cursor += gap;
        for (const i of col) i.x = cursor;
        cursor += colW;
      } else {
        cursor -= gap;
        for (const i of col) i.x = cursor - i.w;
        cursor -= colW;
      }
    }
  }

  // ── Columns: y (stack by where their wires land) ──
  const padTop = 28;
  const padBot = (i: Inst) => (i.axial ? 34 : 12);
  const maxLayer = Math.max(...list.map((i) => i.layer));
  for (let L = 1; L <= maxLayer; L++) {
    for (const side of [-1, 1] as const) {
      const col = list.filter((i) => i.side === side && i.layer === L);
      if (!col.length) continue;
      const desired = new Map<string, number>();
      for (const i of col) {
        const ys: number[] = [];
        if (L === 1) {
          for (const c of connsOf(i.id)) {
            const pin = hubPinOf(c);
            const p = pin ? hub.byPin.get(pin) : undefined;
            if (p) ys.push(hub.y + p.y);
          }
        } else {
          const par = byId.get(parent.get(i.id) ?? "");
          if (par) ys.push(par.y + par.h / 2);
        }
        const cy = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : hub.y + hub.h / 2;
        desired.set(i.id, cy - i.h / 2);
      }
      col.sort((a, b) => desired.get(a.id)! - desired.get(b.id)! || list.indexOf(a) - list.indexOf(b));
      let floor = -Infinity;
      for (const i of col) {
        i.y = Math.max(desired.get(i.id)!, floor + padTop + 10);
        floor = i.y + i.h + padBot(i);
      }
    }
  }

  // ── Bounding box of the parts ──
  const nameW = (i: Inst) => i.name.length * 8.6;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const i of list) {
    minX = Math.min(minX, i.x, i.x + i.w / 2 - nameW(i) / 2);
    maxX = Math.max(maxX, i.x + i.w, i.x + i.w / 2 + nameW(i) / 2);
    minY = Math.min(minY, i.y - 26);
    maxY = Math.max(maxY, i.y + i.h + (i.axial ? 30 : 8));
  }

  // Rail geometry now that the parts have places.
  const absPin = (partId: string, pinId: string): { inst: Inst; pin: DrawnPin; at: Pt } | null => {
    const inst = byId.get(partId);
    const pin = inst?.byPin.get(pinId);
    return inst && pin ? { inst, pin, at: absOf(inst, pin) } : null;
  };
  for (const r of rails) {
    const h = absPin(hub.id, r.conns[0].from.pin)!;
    r.x = h.at.x + r.side * (48 + 24 * r.index);
    const ys = [h.at.y];
    for (const c of r.taps) {
      const t = absPin(c.to.part, c.to.pin);
      if (t) ys.push(t.at.y);
    }
    r.y1 = Math.min(...ys) - 18;
    r.y2 = Math.max(...ys) + 18;
    minY = Math.min(minY, r.y1 - 20);
    maxY = Math.max(maxY, r.y2);
  }
  const railOf = new Map<string, Rail>();
  for (const r of rails) for (const c of r.taps) railOf.set(c.id, r);

  // ── Wires ──
  const topLane = { n: 0 };
  const botLane = { n: 0 };
  const hubMidY = hub.y + hub.h / 2;
  // Arches hug the board: over its top or under its bottom, one lane per wire.
  const detourFor = (a: Pt, b: Pt): number => {
    const up = (a.y + b.y) / 2 <= hubMidY;
    const lane = up ? topLane.n++ : botLane.n++;
    const y = up ? Math.min(a.y, b.y, hub.y) - 34 - lane * 14 : Math.max(a.y, b.y, hub.y + hub.h) + 34 + lane * 14;
    minY = Math.min(minY, y - 8);
    maxY = Math.max(maxY, y + 8);
    return y;
  };
  // First pass: collect geometry so the detour lanes can widen the box.
  type Draw = { c: Connection; d: string; extra?: string; strand?: WireColour };
  const draws: Draw[] = [];
  const needsDetour = (S_: Pt, dS: number, E: Pt, dE: number) => !(dS * (E.x - S_.x) > 24 && dE * (S_.x - E.x) > 24);

  const segment = (c: Connection, a: { at: Pt; pin: DrawnPin }, b: { at: Pt; pin: DrawnPin }, extra?: string) => {
    const dS = dirOf(a.pin);
    const dE = dirOf(b.pin);
    const detour = needsDetour(a.at, dS, b.at, dE) ? detourFor(a.at, b.at) : null;
    draws.push({ c, d: curve(a.at, dS, b.at, dE, detour), extra });
  };

  for (const r of rails) {
    const h = absPin(hub.id, r.conns[0].from.pin)!;
    const ids = r.taps.map((c) => c.id).join(" ");
    draws.push({
      c: r.taps[0],
      d: straight(h.at, { x: r.x, y: h.at.y }),
      extra: ` data-conns="${esc(ids)}"`,
    });
  }
  for (const c of conns) {
    const from = absPin(c.from.part, c.from.pin);
    const to = absPin(c.to.part, c.to.pin);
    if (!from || !to) continue;
    const rail = railOf.get(c.id);
    if (rail) {
      draws.push({ c, d: curve({ x: rail.x, y: to.at.y }, rail.side, to.at, dirOf(to.pin), null) });
      continue;
    }
    if (c.viaPart) {
      const helper = byId.get(c.viaPart);
      const lg = legs.get(c.id);
      const hA = helper && lg ? absPin(helper.id, lg.a) : null;
      const hB = helper && lg ? absPin(helper.id, lg.b) : null;
      if (hA && hB) {
        segment(c, from, hA);
        segment(c, hB, to);
        continue;
      }
    }
    segment(c, from, to);
    // A servo plug's V+ and GND strands run beside its signal wire.
    for (const b of c.bundle ?? []) {
      const a = absPin(b.from.part, b.from.pin);
      const z = absPin(b.to.part, b.to.pin);
      if (!a || !z) continue;
      const dS = dirOf(a.pin);
      const dE = dirOf(z.pin);
      const detour = needsDetour(a.at, dS, z.at, dE) ? detourFor(a.at, z.at) : null;
      draws.push({ c, d: curve(a.at, dS, z.at, dE, detour), strand: b.role === "power" ? "red" : "black" });
    }
  }

  // ── Which colour each pin dot takes ──
  const dotColour = new Map<string, Pick<Connection, "wireColour">>();
  const mark = (ref: string, c: Pick<Connection, "wireColour">) => {
    if (!dotColour.has(ref)) dotColour.set(ref, c);
  };
  for (const c of conns) {
    mark(`${c.from.part}.${c.from.pin}`, c);
    mark(`${c.to.part}.${c.to.pin}`, c);
    for (const b of c.bundle ?? []) {
      const strand = { wireColour: (b.role === "power" ? "red" : "black") as WireColour };
      mark(`${b.from.part}.${b.from.pin}`, strand);
      mark(`${b.to.part}.${b.to.pin}`, strand);
    }
    const lg = legs.get(c.id);
    if (c.viaPart && lg) {
      mark(`${c.viaPart}.${lg.a}`, c);
      mark(`${c.viaPart}.${lg.b}`, c);
    }
  }

  // ── Emit ──
  const width = maxX - minX + 2 * PAD;
  const height = maxY - minY + 2 * PAD;
  const tx = PAD - minX;
  const ty = PAD - minY;

  let out = open(width, height) + `<g transform="translate(${f(tx)} ${f(ty)})">`;

  // Breadboard strips behind series helpers, then rails.
  for (const i of list) {
    if (!i.axial) continue;
    let g = `<g data-breadboard="${esc(i.id)}"><rect x="${f(i.x - 12)}" y="${f(i.y - 14)}" width="${f(i.w + 24)}" height="${f(i.h + 28)}" rx="8" fill="${BREAD}" stroke="${BREAD_LINE}" stroke-width="1.2"/>`;
    for (let x = i.x - 4; x <= i.x + i.w + 4; x += 10) {
      g += `<circle cx="${f(x)}" cy="${f(i.y - 7)}" r="1.6" fill="${BREAD_HOLE}"/><circle cx="${f(x)}" cy="${f(i.y + i.h + 7)}" r="1.6" fill="${BREAD_HOLE}"/>`;
    }
    out += g + "</g>";
  }
  for (const r of rails) {
    const c0 = r.taps[0];
    const hex = WIRE_HEX[c0.wireColour];
    const stripe = WIRE_OUTLINE[c0.wireColour] ?? hex;
    let g = `<g data-rail="${esc(r.key)}"><rect x="${f(r.x - 10)}" y="${f(r.y1)}" width="20" height="${f(r.y2 - r.y1)}" rx="6" fill="${BREAD}" stroke="${BREAD_LINE}" stroke-width="1.2"/>`;
    g += `<path d="M${f(r.x - 5.5)} ${f(r.y1 + 6)}V${f(r.y2 - 6)}" stroke="${stripe}" stroke-width="2.4" stroke-linecap="round"/>`;
    for (let y = r.y1 + 10; y <= r.y2 - 8; y += 11) g += `<circle cx="${f(r.x + 3.5)}" cy="${f(y)}" r="1.8" fill="${BREAD_HOLE}"/>`;
    g += `<text x="${f(r.x)}" y="${f(r.y1 - 6)}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="700" fill="${INK}">${esc(c0.from.label)}</text>`;
    out += g + "</g>";
  }

  // Parts.
  for (const i of list) {
    let g = `<g data-part="${esc(i.id)}" transform="translate(${f(i.x)} ${f(i.y)})">${bodySvg(i)}`;
    const nameY = i.axial ? i.h + 30 : -9;
    g += `<text x="${f(i.w / 2)}" y="${f(nameY)}" text-anchor="middle" font-size="${NAME_FONT}" font-weight="700" fill="${INK}" stroke="${PAPER}" stroke-width="4" paint-order="stroke"${rtl}>${esc(i.name)}</text>`;
    for (const p of i.pins) {
      const used = dotColour.has(p.ref);
      const colour = i.axial ? INK : i.d.textColour;
      if (i.axial) {
        const lx = p.edge === "left" ? 12 : i.w - 12;
        g += `<text data-pin-label="${esc(p.ref)}" x="${f(lx)}" y="-7" text-anchor="middle" font-family="${MONO}" font-size="${PIN_FONT}" font-weight="${used ? 700 : 500}" fill="${colour}">${esc(p.label)}</text>`;
      } else {
        const lx = p.edge === "left" ? p.x + 11 : p.x - 11;
        g += `<text data-pin-label="${esc(p.ref)}" x="${f(lx)}" y="${f(p.y + 4.5)}" text-anchor="${p.edge === "left" ? "start" : "end"}" font-family="${MONO}" font-size="${PIN_FONT}" font-weight="${used ? 700 : 500}" fill="${colour}"${used ? "" : ' fill-opacity=".8"'}>${esc(p.label)}</text>`;
      }
    }
    out += g + "</g>";
  }

  // Wires (under the dots).
  out += `<g class="wires">`;
  for (const w of draws) out += wirePaths(w.d, w.c, w.extra ?? "", w.strand);
  out += `</g>`;

  // Pin dots on top.
  out += `<g class="pins">`;
  for (const i of list) {
    for (const p of i.pins) {
      const c = dotColour.get(p.ref);
      const fill = c ? WIRE_HEX[c.wireColour] : PAPER;
      const stroke = c ? (WIRE_OUTLINE[c.wireColour] ?? INK) : MUTED;
      out += `<circle data-pin="${esc(p.ref)}" cx="${f(i.x + p.x)}" cy="${f(i.y + p.y)}" r="${PIN_R}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`;
    }
  }
  out += `</g></g></svg>`;
  return out;
}
