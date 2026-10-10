// Design Studio schematic: a clean, self-contained SVG from the Studio netlist.
//
// Layout (deterministic, no randomness, no clock):
//   * the board (MCU) in the centre — its USED pins only: supply pins on top
//     with a power bar, grounds at the bottom with a ground symbol, signal
//     pins left/right per pin.side (fallback: alternate);
//   * every other part as a rounded box in a column beside the side of the
//     board its signals use (power parts first, then inputs/sensors left,
//     outputs/displays right). Signal pins face the board, supply and ground
//     pins face outwards with power bars / ground symbols — power and ground
//     are ALWAYS labels, never long wires;
//   * point-to-point signals as short orthogonal wires through a channel,
//     one vertical track each, board pins ordered to match their partner so
//     wires don't cross; any net whose route would cross another wire (or
//     spans both sides) becomes net-name flags at each end instead;
//   * two-legged helpers on a board pin (resistor → LED → ground) drawn inline
//     as symbols (zigzag, LED triangle with arrows) on their net.
// Text is escaped; fonts are system stacks only (no external fonts).

import { esc } from "@/lib/prototyping/netlist";
import { NET_COLOURS } from "./palette";
import type { LibraryPart, Net, Pin, ProductSpec, StudioComponent } from "./schema";
import {
  isMcu,
  isPowerRole,
  isPowerSource,
  splitRef,
  symbolKind,
  type GetPart,
  type Locale,
  type SymbolKind,
} from "./netlist";
import { plainName } from "./plain-checks";

export type SchematicOpts = { locale: Locale; title?: string };

// ── Look ────────────────────────────────────────────────────────────────────

const INK = "#1c2434";
const MUTED = "#64748b";
const LINE = "#c9d3df";
const PAPER = "#ffffff";
const BOARD_FILL = "#eef2f7";
const SANS = "Outfit, system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const PAD = 24;
const ROW = 22;
const HEAD = 42;
const STUB = 10;
const TRACK = 12;
const GAP_Y = 22;
const BOX_MIN_W = 128;
const CHAIN_H = 56;

const KIND_TEXT: Record<LibraryPart["category"], Record<Locale, string>> = {
  mcu: { en: "main board", ar: "اللوحة الرئيسية" },
  power: { en: "power", ar: "الطاقة" },
  sensor: { en: "sensor", ar: "حسّاس" },
  display: { en: "display", ar: "شاشة" },
  input: { en: "input", ar: "إدخال" },
  output: { en: "output", ar: "إخراج" },
  actuator: { en: "motion", ar: "حركة" },
  connector: { en: "connector", ar: "موصّل" },
};

const r1 = (n: number) => Math.round(n * 2) / 2;
const f = (n: number) => String(r1(n));
const textW = (s: string, size: number, mono = false) => s.length * size * (mono ? 0.6 : 0.56);
const pinText = (p: Pin) => p.label.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim() || p.id;

// ── Summary line ────────────────────────────────────────────────────────────

const POWER_TEXT: Record<ProductSpec["power"], Record<Locale, string>> = {
  usb: { en: "USB powered", ar: "يعمل عبر USB" },
  battery: { en: "battery powered", ar: "يعمل بالبطارية" },
  battery_usb: { en: "battery + USB charging", ar: "بطارية مع شحن عبر USB" },
  mains_adapter: { en: "wall adapter", ar: "محوّل كهرباء" },
};
const ENV_TEXT: Record<ProductSpec["environment"], Record<Locale, string>> = {
  indoor: { en: "indoors", ar: "داخلي" },
  outdoor: { en: "outdoors", ar: "خارجي" },
};
const CHIP: [RegExp, string][] = [
  [/esp32/i, "ESP32"],
  [/esp8266/i, "ESP8266"],
  [/arduino[_ ]?uno|\buno\b/i, "Arduino Uno"],
  [/arduino[_ ]?nano|\bnano\b/i, "Arduino Nano"],
  [/pico|rp2040/i, "Pi Pico"],
];

/** "ESP32 · battery powered · indoors" (or the Arabic equivalent). */
export function summaryLine(spec: ProductSpec, components: StudioComponent[], getPart: GetPart, locale: Locale): string {
  const mcu = components.map((c) => getPart(c.partId)).find((p): p is LibraryPart => !!p && isMcu(p));
  const board = mcu
    ? CHIP.find(([re]) => re.test(`${mcu.id} ${mcu.name.en}`))?.[1] ?? plainName(mcu, locale)
    : undefined;
  return [board, POWER_TEXT[spec.power][locale], ENV_TEXT[spec.environment][locale]].filter(Boolean).join(" · ");
}

// ── Geometry types ──────────────────────────────────────────────────────────

type Dir = "L" | "R" | "U" | "D";
type Seg = { x1: number; y1: number; x2: number; y2: number; net: string };
type End = { ref: string; x: number; y: number; dir: Dir; side: "L" | "R" | "T" | "B" };

type Entry = { c: StudioComponent; p: LibraryPart; idx: number };
type ChainEl = { e: Entry; kind: SymbolKind; outNet?: string };
type Chain = {
  mcuPin: string;
  firstNet: string;
  terminal: string; // ref of the first helper's input pin
  els: ChainEl[];
  end: { type: "ground" | "power" | "label" | "open"; net?: string };
};
type Item =
  | { kind: "box"; e: Entry; inner: Pin[]; outer: Pin[]; w: number; h: number; col: "L" | "R"; x: number; y: number }
  | { kind: "chain"; chain: Chain; w: number; h: number; col: "L" | "R"; x: number; y: number; slots: number[] };

/** Perpendicular / collinear overlap between two axis-aligned segments of different nets. */
function clash(a: Seg, b: Seg): boolean {
  if (a.net === b.net) return false;
  const ax1 = Math.min(a.x1, a.x2), ax2 = Math.max(a.x1, a.x2), ay1 = Math.min(a.y1, a.y2), ay2 = Math.max(a.y1, a.y2);
  const bx1 = Math.min(b.x1, b.x2), bx2 = Math.max(b.x1, b.x2), by1 = Math.min(b.y1, b.y2), by2 = Math.max(b.y1, b.y2);
  const e = 3;
  const aH = ay1 === ay2, bH = by1 === by2;
  if (aH && bH) return Math.abs(ay1 - by1) < e && ax1 <= bx2 + e && bx1 <= ax2 + e;
  if (!aH && !bH) return Math.abs(ax1 - bx1) < e && ay1 <= by2 + e && by1 <= ay2 + e;
  const h = aH ? { x1: ax1, x2: ax2, y: ay1 } : { x1: bx1, x2: bx2, y: by1 };
  const v = aH ? { x: bx1, y1: by1, y2: by2 } : { x: ax1, y1: ay1, y2: ay2 };
  return v.x >= h.x1 - e && v.x <= h.x2 + e && h.y >= v.y1 - e && h.y <= v.y2 + e;
}

// ── Render ──────────────────────────────────────────────────────────────────

export function renderSchematicSVG(
  components: StudioComponent[],
  nets: Net[],
  getPart: GetPart,
  opts: SchematicOpts,
): string {
  const { locale } = opts;
  const rtl = locale === "ar" ? ` direction="rtl"` : "";
  const entries: Entry[] = [];
  components.forEach((c, idx) => {
    const p = getPart(c.partId);
    if (p) entries.push({ c, p, idx });
  });
  const byInst = new Map(entries.map((e) => [e.c.instanceId, e]));
  const pinOf = (r: string): { e: Entry; pin: Pin } | undefined => {
    const [inst, id] = splitRef(r);
    const e = byInst.get(inst);
    const pin = e?.p.pins.find((x) => x.id === id);
    return e && pin ? { e, pin } : undefined;
  };
  const netOf = new Map<string, Net>();
  for (const n of nets) for (const r of n.pins) netOf.set(r, n);

  // Net kinds and colours.
  const kindOf = new Map<string, "ground" | "power" | "signal">();
  for (const n of nets) {
    const pins = n.pins.map(pinOf).filter((x): x is { e: Entry; pin: Pin } => !!x);
    const ground = n.name === "GND" || (pins.length > 0 && pins.every((x) => x.pin.role === "gnd"));
    const power = pins.some((x) => isPowerRole(x.pin.role) || (isPowerSource(x.e.p) && x.pin.role !== "gnd"));
    kindOf.set(n.name, ground ? "ground" : power ? "power" : "signal");
  }
  const colour = new Map<string, string>();
  let sig = 0;
  for (const n of nets) {
    const k = kindOf.get(n.name)!;
    colour.set(n.name, k === "ground" ? NET_COLOURS.ground : k === "power" ? NET_COLOURS.power : NET_COLOURS.signals[sig++ % NET_COLOURS.signals.length]);
  }
  const col = (net?: string) => (net ? colour.get(net) ?? INK : MUTED);
  const isRailish = (net?: string) => !!net && kindOf.get(net) !== "signal";

  const mcu = entries.find((e) => isMcu(e.p));
  const mcuInst = mcu?.c.instanceId;
  const onMcu = (r: string) => !!mcuInst && splitRef(r)[0] === mcuInst;

  // ── Inline chains: board pin → resistor → LED → ground ──
  const chains: Chain[] = [];
  const chained = new Set<string>();
  if (mcu) {
    for (const n of nets) {
      if (kindOf.get(n.name) !== "signal" || n.pins.length !== 2) continue;
      const mp = n.pins.find(onMcu);
      const other = n.pins.find((r) => !onMcu(r));
      if (!mp || !other) continue;
      const first = pinOf(other);
      if (!first || !symbolKind(first.e.p) || chained.has(first.e.c.instanceId)) continue;
      const els: ChainEl[] = [];
      let cur: { e: Entry; pin: Pin } | undefined = first;
      let end: Chain["end"] = { type: "open" };
      const visited = new Set<string>();
      while (cur) {
        const kind = symbolKind(cur.e.p);
        if (!kind || visited.has(cur.e.c.instanceId)) break;
        visited.add(cur.e.c.instanceId);
        const outPin: Pin = cur.e.p.pins.find((x) => x.id !== cur!.pin.id)!;
        const outNet = netOf.get(`${cur.e.c.instanceId}.${outPin.id}`);
        els.push({ e: cur.e, kind, outNet: outNet?.name });
        if (!outNet) {
          end = { type: "open" };
          break;
        }
        const k = kindOf.get(outNet.name)!;
        if (k !== "signal") {
          end = { type: k, net: outNet.name };
          break;
        }
        const nextRef = outNet.pins.length === 2 ? outNet.pins.find((r) => r !== `${cur!.e.c.instanceId}.${outPin.id}`) : undefined;
        const next = nextRef ? pinOf(nextRef) : undefined;
        if (next && symbolKind(next.e.p) && !visited.has(next.e.c.instanceId) && !onMcu(nextRef!)) {
          cur = next;
          continue;
        }
        end = { type: "label", net: outNet.name };
        break;
      }
      if (!els.length) continue;
      for (const el of els) chained.add(el.e.c.instanceId);
      chains.push({ mcuPin: mp, firstNet: n.name, terminal: other, els, end });
    }
  }

  // ── Board pins and their sides ──
  const mcuPinIndex = new Map<string, number>();
  const sideOfMcuPin = new Map<string, "L" | "R">();
  const topPins: Pin[] = [];
  const bottomPins: Pin[] = [];
  /** Board signal pins in use (sided or not yet). */
  const boardSig = new Set<string>();
  const unsided: string[] = [];
  if (mcu) {
    mcu.p.pins.forEach((pin, i) => {
      const r = `${mcuInst}.${pin.id}`;
      mcuPinIndex.set(r, i);
      if (!netOf.has(r)) return;
      if (pin.role === "gnd") bottomPins.push(pin);
      else if (isPowerRole(pin.role)) topPins.push(pin);
      else {
        boardSig.add(r);
        if (pin.side === "left") sideOfMcuPin.set(r, "L");
        else if (pin.side === "right") sideOfMcuPin.set(r, "R");
        else unsided.push(r);
      }
    });
  }
  /** Board pins a ref's net reaches directly. */
  const mcuPinsOfNet = (net?: Net) => (net ? net.pins.filter((r) => boardSig.has(r)) : []);

  // ── Items and their columns ──
  const items: Item[] = [];
  const DEFAULT_LEFT = new Set(["power", "sensor", "input"]);
  for (const e of entries) {
    if (e === mcu || chained.has(e.c.instanceId)) continue;
    const inst = e.c.instanceId;
    const powerish = (pin: Pin) => {
      const net = netOf.get(`${inst}.${pin.id}`);
      return net ? isRailish(net.name) : pin.role === "gnd" || isPowerRole(pin.role) || isPowerSource(e.p);
    };
    const linked = (pin: Pin) => mcuPinsOfNet(netOf.get(`${inst}.${pin.id}`));
    const inner = e.p.pins
      .filter((x) => !powerish(x))
      .map((pin, i) => ({ pin, i, k: Math.min(...linked(pin).map((r) => mcuPinIndex.get(r)!), Infinity) }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map((x) => x.pin);
    const outer = e.p.pins.filter(powerish);
    let l = 0, r = 0;
    for (const pin of inner) for (const m of linked(pin)) {
      const s = sideOfMcuPin.get(m);
      if (s === "L") l++;
      else if (s === "R") r++;
    }
    const colSide: "L" | "R" = l > r ? "L" : r > l ? "R" : DEFAULT_LEFT.has(e.p.category) ? "L" : "R";
    const name = plainName(e.p, locale);
    const labW = (ps: Pin[]) => Math.max(0, ...ps.map((p) => textW(pinText(p), 11, true)));
    const w = Math.ceil(Math.max(BOX_MIN_W, textW(name, 14) + 28, textW(KIND_TEXT[e.p.category][locale], 11) + 28, labW(inner) + labW(outer) + 34));
    const rows = Math.max(inner.length, outer.length, 1);
    items.push({ kind: "box", e, inner, outer, w, h: HEAD + rows * ROW + 6, col: colSide, x: 0, y: 0 });
  }
  for (const ch of chains) {
    const slots = ch.els.map((el) => Math.ceil(Math.max(60, textW(plainName(el.e.p, locale), 11) + 10)));
    const endW = ch.end.type === "label" && ch.end.net ? textW(ch.end.net, 11, true) + 26 : ch.end.type === "power" ? textW(ch.end.net ?? "", 11, true) + 22 : 24;
    const w = STUB + slots.reduce((s, x) => s + x, 0) + endW;
    const last = ch.els[ch.els.length - 1].e.p;
    const colSide = sideOfMcuPin.get(ch.mcuPin) ?? (DEFAULT_LEFT.has(last.category) ? "L" : "R");
    items.push({ kind: "chain", chain: ch, w, h: CHAIN_H, col: colSide, x: 0, y: 0, slots });
  }

  // Board pins without a left/right side follow the part they reach; else alternate.
  {
    const colOfRef = new Map<string, "L" | "R">();
    for (const it of items) {
      if (it.kind === "box") for (const p of it.inner) colOfRef.set(`${it.e.c.instanceId}.${p.id}`, it.col);
      else colOfRef.set(it.chain.terminal, it.col);
    }
    let nl = [...sideOfMcuPin.values()].filter((x) => x === "L").length;
    let nr = sideOfMcuPin.size - nl;
    for (const r of unsided) {
      const hit = (netOf.get(r)?.pins ?? []).map((x) => colOfRef.get(x)).find(Boolean);
      const s = hit ?? (nl <= nr ? "L" : "R");
      if (s === "L") nl++;
      else nr++;
      sideOfMcuPin.set(r, s);
    }
  }

  // Column order: power sources first, then by the board pins they use, then the picker's order.
  const rank = (it: Item) => {
    if (it.kind === "chain") return { src: 1, k: mcuPinIndex.get(it.chain.mcuPin) ?? Infinity, idx: it.chain.els[0].e.idx };
    const ks = it.inner.flatMap((p) => mcuPinsOfNet(netOf.get(`${it.e.c.instanceId}.${p.id}`))).map((r) => mcuPinIndex.get(r)!);
    return { src: isPowerSource(it.e.p) ? 0 : 1, k: ks.length ? Math.min(...ks) : Infinity, idx: it.e.idx };
  };
  const sortCol = (side: "L" | "R") =>
    items
      .filter((it) => it.col === side)
      .sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        return ra.src - rb.src || ra.k - rb.k || ra.idx - rb.idx;
      });
  const left = sortCol("L");
  const right = sortCol("R");

  // ── Vertical layout ──
  const titleH = opts.title ? 30 : 0;
  const top = PAD + titleH;
  const mcuTop = top + 44; // room for the board's power bars above it
  const stack = (col: Item[]) => {
    let y = top;
    for (const it of col) {
      it.y = y;
      y += it.h + GAP_Y;
    }
    return col.length ? y - GAP_Y : top;
  };
  const leftBottom = stack(left);
  const rightBottom = stack(right);

  // Positions of inner pins (y only for now) to order the board pins.
  const innerY = new Map<string, number>();
  for (const it of items) {
    if (it.kind === "box") it.inner.forEach((p, i) => innerY.set(`${it.e.c.instanceId}.${p.id}`, it.y + HEAD + i * ROW + ROW / 2));
    else innerY.set(it.chain.terminal, it.y + CHAIN_H / 2);
  }
  const itemSideOf = new Map<string, "L" | "R">();
  for (const it of items) {
    if (it.kind === "box") for (const p of it.inner) itemSideOf.set(`${it.e.c.instanceId}.${p.id}`, it.col);
    else itemSideOf.set(it.chain.terminal, it.col);
  }

  // Board pin rows, ordered by their partner's height so wires don't cross.
  const mcuName = mcu ? plainName(mcu.p, locale) : "";
  const mcuHead = 64; // top pin labels + name + kind
  const sideRows = new Map<string, number>();
  let mcuBottom = mcuTop + mcuHead + ROW;
  if (mcu) {
    for (const side of ["L", "R"] as const) {
      const pins = [...sideOfMcuPin].filter(([, s]) => s === side).map(([r]) => r);
      const target = (r: string) => {
        const ys = (netOf.get(r)?.pins ?? []).filter((x) => itemSideOf.get(x) === side).map((x) => innerY.get(x)!);
        return ys.length ? Math.min(...ys) : Infinity;
      };
      pins.sort((a, b) => target(a) - target(b) || mcuPinIndex.get(a)! - mcuPinIndex.get(b)!);
      let y = mcuTop + mcuHead + ROW / 2 - ROW;
      for (const r of pins) {
        const t = target(r);
        y = Math.max(y + ROW, Number.isFinite(t) ? t : -Infinity, mcuTop + mcuHead + ROW / 2);
        sideRows.set(r, y);
      }
      mcuBottom = Math.max(mcuBottom, y + ROW / 2 + 26);
    }
  }

  // ── Horizontal layout ──
  const roomFor = (col: Item[]) => {
    let w = 30;
    for (const it of col) {
      if (it.kind !== "box") continue;
      for (const p of it.outer) {
        const net = netOf.get(`${it.e.c.instanceId}.${p.id}`)?.name;
        const sym = !net ? 14 : net === "GND" ? 20 : textW(net, 11, true) + 18;
        w = Math.max(w, STUB + sym + 6);
      }
    }
    return w;
  };
  const colW = (col: Item[]) => Math.max(0, ...col.map((it) => it.w));
  const sideNets = (side: "L" | "R") =>
    nets.filter((n) => kindOf.get(n.name) === "signal" && n.pins.some((r) => sideOfMcuPin.get(r) === side || itemSideOf.get(r) === side));
  const channelW = (side: "L" | "R") => {
    const ns = sideNets(side);
    const flag = Math.max(0, ...ns.map((n) => textW(n.name, 11, true) + 18));
    return Math.ceil(Math.max(64, 32 + ns.length * TRACK, 2 * (flag + STUB) + 16));
  };
  const roomL = left.length ? roomFor(left) : 0;
  const roomR = right.length ? roomFor(right) : 0;
  const wL = colW(left);
  const wR = colW(right);
  const chL = mcu && left.length ? channelW("L") : left.length ? 40 : 0;
  const chR = mcu && right.length ? channelW("R") : right.length ? 40 : 0;

  const sideLab = (side: "L" | "R") =>
    Math.max(0, ...[...sideOfMcuPin].filter(([, s]) => s === side).map(([r]) => textW(pinText(pinOf(r)!.pin), 11, true)));
  const topLab = Math.max(0, ...topPins.map((p) => textW(pinText(p), 11, true)), ...bottomPins.map((p) => textW(pinText(p), 11, true)));
  const pitch = Math.max(48, topLab + 14);
  const mcuW = mcu
    ? Math.ceil(Math.max(170, textW(mcuName, 15) + 36, sideLab("L") + sideLab("R") + 48, topPins.length * pitch + 24, bottomPins.length * pitch + 24))
    : 0;

  const xLeftCol = PAD + roomL; // left edge of the widest left box
  const leftInner = xLeftCol + wL; // inner (right) edge of the left column
  const mcuX = leftInner + chL;
  const rightInner = mcuX + mcuW + chR;
  const width = Math.ceil(rightInner + wR + roomR + PAD);
  for (const it of left) it.x = leftInner - it.w;
  for (const it of right) it.x = rightInner;
  const mcuH = mcuBottom - mcuTop;
  const height = Math.ceil(Math.max(leftBottom, rightBottom, mcu ? mcuBottom + 34 : top) + PAD);

  // ── Endpoints ──
  const ends = new Map<string, End>();
  const out: string[] = [];
  const wires: string[] = [];
  const labels: string[] = [];
  const segs: Seg[] = [];

  for (const it of items) {
    if (it.kind === "box") {
      const inst = it.e.c.instanceId;
      const innerX = it.col === "L" ? it.x + it.w : it.x;
      const outerX = it.col === "L" ? it.x : it.x + it.w;
      it.inner.forEach((p, i) => {
        const y = it.y + HEAD + i * ROW + ROW / 2;
        ends.set(`${inst}.${p.id}`, { ref: `${inst}.${p.id}`, x: innerX + (it.col === "L" ? STUB : -STUB), y, dir: it.col === "L" ? "R" : "L", side: it.col });
      });
      it.outer.forEach((p, i) => {
        const y = it.y + HEAD + i * ROW + ROW / 2;
        ends.set(`${inst}.${p.id}`, { ref: `${inst}.${p.id}`, x: outerX + (it.col === "L" ? -STUB : STUB), y, dir: it.col === "L" ? "L" : "R", side: it.col === "L" ? "R" : "L" });
      });
    } else {
      const innerX = it.col === "L" ? it.x + it.w : it.x;
      ends.set(it.chain.terminal, { ref: it.chain.terminal, x: innerX, y: it.y + CHAIN_H / 2, dir: it.col === "L" ? "R" : "L", side: it.col });
    }
  }
  if (mcu) {
    for (const [r, side] of sideOfMcuPin) {
      const y = sideRows.get(r)!;
      ends.set(r, { ref: r, x: side === "L" ? mcuX - STUB : mcuX + mcuW + STUB, y, dir: side === "L" ? "L" : "R", side });
    }
    const place = (pins: Pin[], y: number, dir: Dir, side: "T" | "B") => {
      const total = pins.length * pitch;
      pins.forEach((p, i) => {
        const x = mcuX + mcuW / 2 - total / 2 + pitch * i + pitch / 2;
        ends.set(`${mcuInst}.${p.id}`, { ref: `${mcuInst}.${p.id}`, x, y: y + (dir === "U" ? -STUB : STUB), dir, side });
      });
    };
    place(topPins, mcuTop, "U", "T");
    place(bottomPins, mcuTop + mcuH, "D", "B");
  }

  // ── Symbols for power / ground and net flags ──
  const groundSym = (x: number, y: number, dir: Dir) => {
    // A short lead in `dir`, then three bars under it.
    const lead = dir === "U" || dir === "D" ? 0 : 6;
    const gx = dir === "L" ? x - lead : x + lead;
    const gy = dir === "D" ? y + 4 : y;
    const c = NET_COLOURS.ground;
    let s = "";
    if (lead) s += `<path d="M${f(x)} ${f(y)}H${f(gx)}V${f(gy + 6)}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    else s += `<path d="M${f(x)} ${f(y)}V${f(gy + 6)}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    s += `<path d="M${f(gx - 8)} ${f(gy + 6)}H${f(gx + 8)}M${f(gx - 5)} ${f(gy + 9.5)}H${f(gx + 5)}M${f(gx - 2)} ${f(gy + 13)}H${f(gx + 2)}" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`;
    return s;
  };
  const powerSym = (x: number, y: number, dir: Dir, net: string, c: string) => {
    const t = esc(net);
    if (dir === "U")
      return `<path d="M${f(x - 9)} ${f(y)}H${f(x + 9)}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><text x="${f(x)}" y="${f(y - 5)}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${c}">${t}</text>`;
    if (dir === "D")
      return `<path d="M${f(x - 9)} ${f(y)}H${f(x + 9)}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><text x="${f(x)}" y="${f(y + 12)}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${c}">${t}</text>`;
    const bx = x;
    const tx = dir === "L" ? bx - 5 : bx + 5;
    return `<path d="M${f(bx)} ${f(y - 7)}V${f(y + 7)}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><text x="${f(tx)}" y="${f(y + 3)}" text-anchor="${dir === "L" ? "end" : "start"}" font-family="${MONO}" font-size="11" font-weight="700" fill="${c}">${t}</text>`;
  };
  const flag = (x: number, y: number, dir: Dir, net: string) => {
    const c = col(net);
    const w = textW(net, 11, true) + 12;
    const s = dir === "L" ? -1 : 1;
    const x0 = x, x1 = x + s * 6, x2 = x1 + s * w;
    const pts = [[x0, y], [x1, y - 7], [x2, y - 7], [x2, y + 7], [x1, y + 7]].map(([a, b]) => `${f(a)},${f(b)}`).join(" ");
    segs.push({ x1: Math.min(x0, x2), y1: y, x2: Math.max(x0, x2), y2: y, net });
    return `<g data-net="${esc(net)}"><polygon points="${pts}" fill="${PAPER}" stroke="${c}" stroke-width="1.4"/><text x="${f((x1 + x2) / 2)}" y="${f(y + 3)}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="600" fill="${c}">${esc(net)}</text></g>`;
  };
  const nc = (x: number, y: number) =>
    `<path d="M${f(x - 3)} ${f(y - 3)}L${f(x + 3)} ${f(y + 3)}M${f(x + 3)} ${f(y - 3)}L${f(x - 3)} ${f(y + 3)}" stroke="${MUTED}" stroke-width="1.4"/>`;

  // Power / ground at every endpoint on a rail net, and no-connect marks.
  for (const [r, end] of ends) {
    const net = netOf.get(r);
    if (!net) {
      labels.push(nc(end.x, end.y));
      continue;
    }
    const k = kindOf.get(net.name)!;
    if (k === "signal") continue;
    if (net.name === "GND") labels.push(`<g data-net="GND">${groundSym(end.x, end.y, end.dir)}</g>`);
    else labels.push(`<g data-net="${esc(net.name)}">${powerSym(end.x, end.y, end.dir, net.name, k === "ground" ? NET_COLOURS.ground : NET_COLOURS.power)}</g>`);
  }

  // ── Signal routing ──
  const chainNets = new Set<string>();
  for (const ch of chains) for (const el of ch.els) if (el.outNet && kindOf.get(el.outNet) === "signal" && el !== ch.els[ch.els.length - 1]) chainNets.add(el.outNet);
  const signalNets = nets.filter((n) => kindOf.get(n.name) === "signal" && !chainNets.has(n.name));
  const routeSide = (n: Net): "L" | "R" | null => {
    const drawn = n.pins.filter((r) => ends.has(r));
    if (drawn.length !== n.pins.length || drawn.length < 2) return null;
    const sides = new Set(drawn.map((r) => ends.get(r)!.side));
    if (sides.size !== 1) return null;
    const s = [...sides][0];
    if (s !== "L" && s !== "R") return null;
    // Only inner pins / board side pins face the channel.
    const ok = drawn.every((r) => sideOfMcuPin.has(r) || itemSideOf.get(r) === s);
    return ok ? s : null;
  };
  const labelled: Net[] = [];
  const direct: { n: Net; side: "L" | "R" }[] = [];
  for (const n of signalNets) {
    const s = mcu ? routeSide(n) : null;
    if (s) direct.push({ n, side: s });
    else labelled.push(n);
  }
  const drawFlags = (n: Net) => {
    for (const r of n.pins) {
      const e = ends.get(r);
      if (!e) continue;
      labels.push(flag(e.x, e.y, e.dir, n.name));
    }
  };
  for (const n of labelled) drawFlags(n);

  for (const side of ["L", "R"] as const) {
    const list = direct.filter((d) => d.side === side).map((d) => d.n);
    const yOf = (r: string) => ends.get(r)!.y;
    const itemY = (n: Net) => Math.min(...n.pins.filter((r) => !sideOfMcuPin.has(r)).map(yOf));
    list.sort((a, b) => itemY(a) - itemY(b) || a.name.localeCompare(b.name));
    const T = Math.max(1, list.length);
    const itemEdge = side === "L" ? leftInner + STUB : rightInner - STUB;
    const trackX = (k: number) => (side === "L" ? itemEdge + 16 + k * TRACK : itemEdge - 16 - k * TRACK);
    for (const n of list) {
      const pts = n.pins.map((r) => ends.get(r)!);
      const mcuEnd = pts.find((p) => sideOfMcuPin.has(p.ref));
      const ys = pts.map((p) => p.y);
      const tryRoute = (k: number | null): Seg[] => {
        if (k === null) {
          const [a, b] = pts;
          return [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y, net: n.name }];
        }
        const x = trackX(k);
        const s: Seg[] = pts.map((p) => ({ x1: p.x, y1: p.y, x2: x, y2: p.y, net: n.name }));
        s.push({ x1: x, y1: Math.min(...ys), x2: x, y2: Math.max(...ys), net: n.name });
        return s;
      };
      const free = (s: Seg[]) => s.every((a) => segs.every((b) => !clash(a, b)));
      let chosen: Seg[] | null = null;
      let track: number | null = null;
      if (pts.length === 2 && Math.abs(pts[0].y - pts[1].y) < 0.5 && free(tryRoute(null))) chosen = tryRoute(null);
      else {
        const down = mcuEnd ? mcuEnd.y > itemY(n) : false;
        const order = Array.from({ length: T }, (_, i) => (down ? T - 1 - i : i));
        for (const k of order) {
          const s = tryRoute(k);
          if (free(s)) {
            chosen = s;
            track = k;
            break;
          }
        }
      }
      if (!chosen) {
        drawFlags(n);
        continue;
      }
      segs.push(...chosen);
      const c = col(n.name);
      const d = chosen.map((s) => `M${f(s.x1)} ${f(s.y1)}L${f(s.x2)} ${f(s.y2)}`).join("");
      let g = `<g data-net="${esc(n.name)}"><path d="${d}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (track !== null && pts.length > 2) {
        const x = trackX(track);
        const lo = Math.min(...ys), hi = Math.max(...ys);
        for (const p of pts) if (p.y > lo + 0.5 && p.y < hi - 0.5) g += `<circle cx="${f(x)}" cy="${f(p.y)}" r="3" fill="${c}"/>`;
      }
      // The net name rides on the wire next to the part.
      const lp = pts.find((p) => !sideOfMcuPin.has(p.ref)) ?? pts[0];
      const lx = side === "L" ? lp.x + 4 : lp.x - 4;
      g += `<text x="${f(lx)}" y="${f(lp.y - 4)}" text-anchor="${side === "L" ? "start" : "end"}" font-family="${MONO}" font-size="10" fill="${c}">${esc(n.name)}</text></g>`;
      wires.push(g);
    }
  }

  // ── Boxes ──
  const kindText = (p: LibraryPart) => esc(KIND_TEXT[p.category][locale]);
  for (const it of items) {
    if (it.kind !== "box") continue;
    const { e } = it;
    const inst = e.c.instanceId;
    let g = `<g data-part="${esc(inst)}"><rect x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" rx="10" fill="${PAPER}" stroke="${LINE}" stroke-width="1.4"/>`;
    g += `<text x="${f(it.x + it.w / 2)}" y="${f(it.y + 18)}" text-anchor="middle" font-size="14" font-weight="600" fill="${INK}"${rtl}>${esc(plainName(e.p, locale))}</text>`;
    g += `<text x="${f(it.x + it.w / 2)}" y="${f(it.y + 31)}" text-anchor="middle" font-size="11" fill="${MUTED}"${rtl}>${kindText(e.p)}</text>`;
    const innerX = it.col === "L" ? it.x + it.w : it.x;
    const outerX = it.col === "L" ? it.x : it.x + it.w;
    const pinRow = (p: Pin, i: number, x: number, outward: number, anchorInside: "start" | "end") => {
      const y = it.y + HEAD + i * ROW + ROW / 2;
      const net = netOf.get(`${inst}.${p.id}`)?.name;
      const c = col(net);
      const tx = anchorInside === "end" ? x - 6 : x + 6;
      return `<path d="M${f(x)} ${f(y)}H${f(x + outward * STUB)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="${f(x)}" cy="${f(y)}" r="2" fill="${c}"/><text x="${f(tx)}" y="${f(y + 3)}" text-anchor="${anchorInside}" font-family="${MONO}" font-size="11" fill="${INK}">${esc(pinText(p))}</text>`;
    };
    it.inner.forEach((p, i) => (g += pinRow(p, i, innerX, it.col === "L" ? 1 : -1, it.col === "L" ? "end" : "start")));
    it.outer.forEach((p, i) => (g += pinRow(p, i, outerX, it.col === "L" ? -1 : 1, it.col === "L" ? "start" : "end")));
    out.push(g + "</g>");
  }

  // ── Chains (inline symbols) ──
  for (const it of items) {
    if (it.kind !== "chain") continue;
    const ch = it.chain;
    const s = it.col === "L" ? -1 : 1; // drawing direction, away from the board
    const cy = it.y + CHAIN_H / 2;
    let x = it.col === "L" ? it.x + it.w : it.x;
    let g = `<g data-chain="${esc(ch.firstNet)}">`;
    const wire = (x1: number, x2: number, net?: string) =>
      `<path d="M${f(x1)} ${f(cy)}H${f(x2)}" stroke="${col(net)}" stroke-width="2" stroke-linecap="round"/>`;
    g += `<circle cx="${f(x)}" cy="${f(cy)}" r="2" fill="${col(ch.firstNet)}"/>`;
    let net: string | undefined = ch.firstNet;
    g += wire(x, x + s * STUB, net);
    x += s * STUB;
    ch.els.forEach((el, i) => {
      const slot = it.slots[i];
      const cx = x + (s * slot) / 2;
      const half = el.kind === "resistor" ? 14 : 8;
      g += wire(x, cx - s * half, net);
      if (el.kind === "resistor") {
        const pts: string[] = [];
        for (let k = 0; k <= 6; k++) {
          const px = cx - s * 14 + s * (28 / 6) * k;
          const py = k === 0 || k === 6 ? cy : cy + (k % 2 ? -5 : 5);
          pts.push(`${f(px)},${f(py)}`);
        }
        g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
      } else {
        const a = cx - s * 7, b = cx + s * 7;
        g += `<polygon points="${f(a)},${f(cy - 7)} ${f(a)},${f(cy + 7)} ${f(b)},${f(cy)}" fill="${el.kind === "led" ? "#fef3c7" : PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
        g += `<path d="M${f(b)} ${f(cy - 7)}V${f(cy + 7)}" stroke="${INK}" stroke-width="1.8"/>`;
        if (el.kind === "led") {
          for (const off of [0, 5]) {
            const x0 = cx - s * 1 + s * off, y0 = cy - 9;
            const x1 = x0 + s * 5, y1 = y0 - 6;
            g += `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}M${f(x1 - s * 3.2)} ${f(y1 + 0.4)}L${f(x1)} ${f(y1)}L${f(x1 - s * 0.6)} ${f(y1 + 3.2)}" stroke="${NET_COLOURS.signals[2]}" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
          }
        }
      }
      const name = plainName(el.e.p, locale);
      const ty = i % 2 === 0 ? cy - 13 : cy + 20;
      g += `<text x="${f(cx)}" y="${f(ty)}" text-anchor="middle" font-size="11" fill="${MUTED}"${rtl} data-part="${esc(el.e.c.instanceId)}">${esc(name)}</text>`;
      net = el.outNet;
      g += wire(cx + s * half, x + s * slot, net);
      x += s * slot;
    });
    const endNet = ch.end.net;
    if (ch.end.type === "ground" && endNet === "GND") g += groundSym(x, cy, s < 0 ? "L" : "R");
    else if ((ch.end.type === "ground" || ch.end.type === "power") && endNet)
      g += wire(x, x + s * 6, endNet) + powerSym(x + s * 6, cy, s < 0 ? "L" : "R", endNet, ch.end.type === "ground" ? NET_COLOURS.ground : NET_COLOURS.power);
    else if (ch.end.type === "label" && endNet) g += flag(x, cy, s < 0 ? "L" : "R", endNet);
    else g += nc(x, cy);
    g += `<g data-net="${esc(ch.firstNet)}"></g>`;
    for (const el of ch.els) if (el.outNet) g += `<g data-net="${esc(el.outNet)}"></g>`;
    out.push(g + "</g>");
  }

  // ── The board ──
  if (mcu) {
    let g = `<g data-part="${esc(mcu.c.instanceId)}"><rect x="${f(mcuX)}" y="${f(mcuTop)}" width="${f(mcuW)}" height="${f(mcuH)}" rx="12" fill="${BOARD_FILL}" stroke="${INK}" stroke-width="1.6"/>`;
    g += `<text x="${f(mcuX + mcuW / 2)}" y="${f(mcuTop + 38)}" text-anchor="middle" font-size="15" font-weight="700" fill="${INK}"${rtl}>${esc(mcuName)}</text>`;
    g += `<text x="${f(mcuX + mcuW / 2)}" y="${f(mcuTop + 51)}" text-anchor="middle" font-size="11" fill="${MUTED}"${rtl}>${kindText(mcu.p)}</text>`;
    for (const [r, side] of sideOfMcuPin) {
      const e = ends.get(r)!;
      const p = pinOf(r)!.pin;
      const net = netOf.get(r)?.name;
      const c = col(net);
      const edge = side === "L" ? mcuX : mcuX + mcuW;
      g += `<path d="M${f(edge)} ${f(e.y)}H${f(e.x)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="${f(edge)}" cy="${f(e.y)}" r="2" fill="${c}"/>`;
      g += `<text x="${f(side === "L" ? edge + 6 : edge - 6)}" y="${f(e.y + 3)}" text-anchor="${side === "L" ? "start" : "end"}" font-family="${MONO}" font-size="11" fill="${INK}">${esc(pinText(p))}</text>`;
    }
    for (const p of [...topPins, ...bottomPins]) {
      const r = `${mcuInst}.${p.id}`;
      const e = ends.get(r)!;
      const net = netOf.get(r)?.name;
      const c = col(net);
      const edge = e.dir === "U" ? mcuTop : mcuTop + mcuH;
      g += `<path d="M${f(e.x)} ${f(edge)}V${f(e.y)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="${f(e.x)}" cy="${f(edge)}" r="2" fill="${c}"/>`;
      g += `<text x="${f(e.x)}" y="${f(e.dir === "U" ? edge + 13 : edge - 6)}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${INK}">${esc(pinText(p))}</text>`;
    }
    out.push(g + "</g>");
  }

  const title = opts.title
    ? `<text x="${locale === "ar" ? width - PAD : PAD}" y="${PAD + 14}" font-size="17" font-weight="700" fill="${INK}"${rtl}>${esc(opts.title)}</text>`
    : "";
  const aria = esc(opts.title ?? (locale === "ar" ? "مخطط التوصيل" : "Wiring diagram"));
  // Nets with nothing to draw still get a hook so the UI can find every net.
  const drawn = new Set<string>();
  for (const s of [...wires, ...labels, ...out].join("").matchAll(/data-net="([^"]*)"/g)) drawn.add(s[1]);
  const hooks = nets.filter((n) => !drawn.has(esc(n.name))).map((n) => `<g data-net="${esc(n.name)}"></g>`).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${aria}" font-family="${SANS}" direction="ltr">` +
    `<title>${aria}</title>` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="${PAPER}"/>` +
    title +
    `<g class="wires">${wires.join("")}</g>` +
    `<g class="parts">${out.join("")}</g>` +
    `<g class="labels">${labels.join("")}${hooks}</g>` +
    `</svg>`
  );
}
