// Wiring views (P5-17): ONE source of truth for every view of a circuit.
//
// The Wiring drawing, the 3D wires, the schematic, the pin list, the code's pin
// block and the Wokwi export all read the same Connection[] built here from the
// Studio netlist (lib/studio/netlist.ts). A Connection is one physical wire a
// person lays: from a hub pin (the supply, else the board, else the first pin
// of the net) to every other pin on the net. A series helper on a board pin
// (board → resistor → LED) is folded into ONE connection with `viaPart`.
//
// Order = build order: ground first, then power, then each signal; ids c1, c2…
// follow that order. Colours are deterministic: red for every supply, black for
// ground, then one colour per signal net from a fixed palette, the same net the
// same colour everywhere.
//
// Pure and client-safe. Same input → same output.

import type { LibraryPart, Net, Pin, PinRole, StudioComponent } from "./schema";
import {
  isBattery,
  isCharger,
  isConverter,
  isMcu,
  isPowerRole,
  chargerPins,
  splitRef,
  symbolKind,
  tagged,
  type GetPart,
  type Locale,
} from "./netlist";
import { plainName } from "./plain-checks";

// ── Colours ─────────────────────────────────────────────────────────────────

export const WIRE_COLOURS = ["red", "black", "yellow", "blue", "green", "orange", "white", "purple"] as const;
export type WireColour = (typeof WIRE_COLOURS)[number];
/** Signal nets take these in order (red / black are reserved for supply / ground). */
export const SIGNAL_COLOURS: readonly WireColour[] = ["yellow", "blue", "green", "orange", "white", "purple"];

/** Wire fill. "white" is drawn with a dark outline by every view. */
export const WIRE_HEX: Record<WireColour, string> = {
  red: "#dc2626",
  black: "#1c2434",
  yellow: "#eab308",
  blue: "#2563eb",
  green: "#16a34a",
  orange: "#f97316",
  white: "#f8fafc",
  purple: "#9333ea",
};
/** Outline for wires that would vanish on white paper. */
export const WIRE_OUTLINE: Partial<Record<WireColour, string>> = { white: "#94a3b8", yellow: "#a16207" };

export const WIRE_NAME: Record<WireColour, Record<Locale, string>> = {
  red: { en: "red", ar: "أحمر" },
  black: { en: "black", ar: "أسود" },
  yellow: { en: "yellow", ar: "أصفر" },
  blue: { en: "blue", ar: "أزرق" },
  green: { en: "green", ar: "أخضر" },
  orange: { en: "orange", ar: "برتقالي" },
  white: { en: "white", ar: "أبيض" },
  purple: { en: "purple", ar: "بنفسجي" },
};

// ── Model ───────────────────────────────────────────────────────────────────

export const CONNECTION_ROLES = ["power", "ground", "signal", "i2c", "spi", "uart", "pwm", "analog"] as const;
export type ConnectionRole = (typeof CONNECTION_ROLES)[number];

export type ConnectionEnd = {
  /** Component instance id ("esp32_devkit_1"). */
  part: string;
  /** Library part id ("esp32_devkit"). */
  partId: string;
  /** Pin id on the part ("GPIO4"). */
  pin: string;
  /** Short pin label for people ("GPIO4", "+", "VCC"). */
  label: string;
};

export type Connection = {
  /** c1, c2… in build order. */
  id: string;
  from: ConnectionEnd;
  to: ConnectionEnd;
  /** The net this wire is on (the board side when a helper sits in between). */
  net: string;
  role: ConnectionRole;
  wireColour: WireColour;
  /** Instance id of a two-legged helper in series (a resistor) between from and to. */
  viaPart?: string;
  /** Library part id of `viaPart` ("resistor_220"). */
  viaPartId?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const GROUND_NETS = new Set(["GND", "BAT-"]);
const SUPPLY_NETS = new Set(["VBAT", "VSYS", "VREG", "3V3", "5V"]);

/** Short pin label: no parentheses; an LED's legs are "+" / "−". */
export function pinLabel(p: LibraryPart, pin: Pin): string {
  if (symbolKind(p) === "led") {
    if (pin.role === "gnd" || /^(K|CATHODE|-)/i.test(pin.id)) return "−";
    return "+";
  }
  const t = pin.label.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  // Boards print two names on some pins ("VP / GPIO36", "A5 / SCL"): keep the one that is the pin id.
  if (t.includes("/")) {
    const parts = t.split("/").map((x) => x.trim()).filter(Boolean);
    return parts.find((x) => x.toUpperCase() === pin.id.toUpperCase()) ?? parts[parts.length - 1] ?? pin.id;
  }
  if (isMcu(p) && pin.role === "gnd") return "GND";
  return t || pin.id;
}

/** A part's short name for labels ("ESP32 brain board"). */
export function partName(p: LibraryPart | undefined, locale: Locale, fallback = ""): string {
  return p ? plainName(p, locale) : fallback;
}

/** Stable key for a wire that survives re-numbering (pin-list ticks are saved by it). */
export function connectionKey(c: Pick<Connection, "from" | "to">): string {
  return `${c.from.part}.${c.from.pin}>${c.to.part}.${c.to.pin}`;
}

type PinInfo = { ref: string; inst: string; pinId: string; part: LibraryPart; pin: Pin; mcu: boolean };

function pinInfo(ref: string, partOf: Map<string, LibraryPart>): PinInfo | null {
  const [inst, pinId] = splitRef(ref);
  const part = partOf.get(inst);
  const pin = part?.pins.find((x) => x.id === pinId);
  if (!part || !pin) return null;
  return { ref, inst, pinId, part, pin, mcu: isMcu(part) };
}

const end = (x: PinInfo): ConnectionEnd => ({ part: x.inst, partId: x.part.id, pin: x.pinId, label: pinLabel(x.part, x.pin) });

/** Supply outputs: a battery's +, a charger's OUT, a converter's output. */
function isSupplyOut(x: PinInfo): boolean {
  if (isBattery(x.part)) return x.pin.role !== "gnd";
  if (isCharger(x.part)) return chargerPins(x.part).out?.id === x.pinId;
  if (isConverter(x.part)) return x.pin.role === "5v" || x.pin.role === "3v3";
  // Any other power part (a USB-C 5 V input board) feeds its rail.
  if (x.part.category === "power") return isPowerRole(x.pin.role) || /OUT|5V|VBUS/i.test(`${x.pinId} ${x.pin.label}`) && x.pin.role !== "gnd";
  return false;
}

function roleOf(net: string, pins: PinInfo[]): ConnectionRole {
  if (GROUND_NETS.has(net) || pins.every((x) => x.pin.role === "gnd")) return "ground";
  if (SUPPLY_NETS.has(net) || /^(VBAT|VSYS|VREG|3V3|5V)(_\d+)?$/.test(net) || pins.some((x) => isPowerRole(x.pin.role)))
    return "power";
  // Bus kinds come from the device side: a spare SPI pin on the board does not make a data line SPI.
  const devPins = pins.filter((x) => !x.mcu);
  const roles = new Set<PinRole>((devPins.length ? devPins : pins).map((x) => x.pin.role));
  if (roles.has("i2c_sda") || roles.has("i2c_scl")) return "i2c";
  if ([...roles].some((r) => r.startsWith("spi_"))) return "spi";
  if (roles.has("uart_tx") || roles.has("uart_rx")) return "uart";
  const dev = pins.filter((x) => !x.mcu);
  const board = pins.find((x) => x.mcu);
  if (dev.some((x) => x.pin.role === "pwm")) return "pwm";
  if (board?.pin.role === "pwm" && dev.some((x) => tagged(x.part, ["pwm", "servo", "buzzer", "dimmable", "dimmer", "speaker"])))
    return "pwm";
  if (dev.some((x) => x.pin.role === "adc") || (board?.pin.role === "adc" && dev.some((x) => tagged(x.part, ["analog", "analogue"]))))
    return "analog";
  return "signal";
}

const ROLE_ORDER: Record<ConnectionRole, number> = {
  ground: 0, power: 1, signal: 2, i2c: 2, spi: 2, uart: 2, pwm: 2, analog: 2,
};

// ── buildConnections ────────────────────────────────────────────────────────

/**
 * Netlist → wires. Every net becomes (pins − 1) wires from its hub; a net that
 * runs board pin → series helper → host becomes one wire with `viaPart`.
 */
export function buildConnections(components: StudioComponent[], nets: Net[], getPart: GetPart): Connection[] {
  const partOf = new Map<string, LibraryPart>();
  for (const c of components) {
    const p = getPart(c.partId);
    if (p) partOf.set(c.instanceId, p);
  }
  const netOf = new Map<string, Net>();
  for (const n of nets) for (const r of n.pins) netOf.set(r, n);

  type Draft = Omit<Connection, "id" | "wireColour">;
  const drafts: Draft[] = [];
  const folded = new Set<string>(); // nets swallowed into a via connection

  // Series helpers first: board pin → helper leg a, helper leg b → host.
  for (const n of nets) {
    const infos = n.pins.map((r) => pinInfo(r, partOf)).filter((x): x is PinInfo => !!x);
    const board = infos.find((x) => x.mcu);
    const helpers = infos.filter((x) => symbolKind(x.part) === "resistor");
    if (!board || helpers.length !== 1 || infos.length !== 2) continue;
    const h = helpers[0];
    const other = h.part.pins.find((x) => x.id !== h.pinId);
    if (!other) continue;
    const far = netOf.get(`${h.inst}.${other.id}`);
    if (!far || far.pins.length !== 2) continue;
    const hostRef = far.pins.find((r) => !r.startsWith(`${h.inst}.`));
    const host = hostRef ? pinInfo(hostRef, partOf) : null;
    if (!host) continue;
    folded.add(n.name);
    folded.add(far.name);
    drafts.push({ from: end(board), to: end(host), net: n.name, role: roleOf(n.name, [board, host]), viaPart: h.inst, viaPartId: h.part.id });
  }

  for (const n of nets) {
    if (folded.has(n.name)) continue;
    const infos = n.pins.map((r) => pinInfo(r, partOf)).filter((x): x is PinInfo => !!x);
    if (infos.length < 2) continue;
    const hub = infos.find(isSupplyOut) ?? infos.find((x) => x.mcu) ?? infos[0];
    const role = roleOf(n.name, infos);
    for (const x of infos) {
      if (x === hub) continue;
      drafts.push({ from: end(hub), to: end(x), net: n.name, role });
    }
  }

  // Build order: ground, power, then signals in net order (stable sort keeps net order).
  const netIndex = new Map(nets.map((n, i) => [n.name, i]));
  const sorted = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => ROLE_ORDER[a.d.role] - ROLE_ORDER[b.d.role] || (netIndex.get(a.d.net) ?? 0) - (netIndex.get(b.d.net) ?? 0) || a.i - b.i)
    .map((x) => x.d);

  const colourOf = new Map<string, WireColour>();
  let next = 0;
  return sorted.map((d, i) => {
    let wireColour: WireColour;
    if (d.role === "power") wireColour = "red";
    else if (d.role === "ground") wireColour = "black";
    else {
      if (!colourOf.has(d.net)) colourOf.set(d.net, SIGNAL_COLOURS[next++ % SIGNAL_COLOURS.length]);
      wireColour = colourOf.get(d.net)!;
    }
    return { id: `c${i + 1}`, ...d, wireColour };
  });
}

/** Colour of a net in every view (signals follow the wire; unknown nets grey). */
export function netColourMap(connections: Connection[]): Map<string, WireColour> {
  const m = new Map<string, WireColour>();
  for (const c of connections) if (!m.has(c.net)) m.set(c.net, c.wireColour);
  return m;
}

/** Connections touching an instance pin ("led_5mm_1.A"), including via helpers. */
export function connectionsAt(connections: Connection[], part: string, pin?: string): Connection[] {
  return connections.filter(
    (c) =>
      (c.from.part === part && (!pin || c.from.pin === pin)) ||
      (c.to.part === part && (!pin || c.to.pin === pin)) ||
      (!pin && c.viaPart === part),
  );
}

/** "ESP32 brain board GPIO4 → Light + (yellow)". */
export function describeConnection(c: Connection, getPart: GetPart, locale: Locale): string {
  const a = `${partName(getPart(c.from.partId), locale, c.from.part)} ${c.from.label}`;
  const b = `${partName(getPart(c.to.partId), locale, c.to.part)} ${c.to.label}`;
  return `${a} → ${b} (${WIRE_NAME[c.wireColour][locale]})`;
}

// ── Code: pin constants and the pin block ──────────────────────────────────

/** Value a sketch uses for a board pin: "2" for D2 / GPIO2 / GP2, "A0" for A0. */
export function boardPinValue(pinId: string): string | null {
  const id = pinId.toUpperCase();
  let m = /^(?:GPIO|GP|IO|D)(\d+)$/.exec(id);
  if (m) return String(Number(m[1]));
  m = /^A(\d+)$/.exec(id);
  if (m) return `A${Number(m[1])}`;
  return null;
}

export type PinConstant = {
  name: string;
  value: string;
  /** Connections this constant names (a bus pin can feed several parts). */
  connectionIds: string[];
  /** The first connection's wire, for the comment and the swatch. */
  colour: WireColour;
  /** "yellow wire → Light + (c1)". */
  comment: string;
};

const BUS_CONST: Record<string, string> = {
  SDA: "I2C_SDA_PIN", SCL: "I2C_SCL_PIN", MOSI: "SPI_MOSI_PIN", MISO: "SPI_MISO_PIN", SCK: "SPI_SCK_PIN",
};

/**
 * One `const int NAME = value;` per board signal net. Names come from the net
 * codes: LED1 → LED_PIN (LED1_PIN when there are several), BTN → BUTTON_PIN,
 * SOIL_AOUT → SOIL_PIN when the part has one signal, buses I2C_SDA_PIN…
 * Comments are English (code comments stay English in both locales).
 */
export function pinConstants(connections: Connection[], getPart: GetPart): PinConstant[] {
  const sig = connections.filter((c) => c.role !== "power" && c.role !== "ground");
  const byNet = new Map<string, Connection[]>();
  for (const c of sig) {
    const board = getPart(c.from.partId);
    if (!board || !isMcu(board)) continue;
    if (!boardPinValue(c.from.pin)) continue;
    byNet.set(c.net, [...(byNet.get(c.net) ?? []), c]);
  }
  const nets = [...byNet.keys()];
  const countBase = (b: string) => nets.filter((n) => n.replace(/\d+$/, "") === b).length;
  const used = new Set<string>();
  const out: PinConstant[] = [];
  for (const net of nets) {
    const cs = byNet.get(net)!;
    const first = cs[0];
    let base: string;
    if (BUS_CONST[net]) base = BUS_CONST[net].replace(/_PIN$/, "");
    else {
      const dev = getPart(first.to.partId);
      const signals = dev?.pins.filter((p) => !isPowerRole(p.role) && p.role !== "gnd").length ?? 1;
      const code = net.split("_")[0];
      const numbered = /^(LED|BTN)\d+$/.test(code);
      const kind = code.replace(/\d+$/, "");
      if (numbered) base = countBase(kind) > 1 ? code.replace(/^BTN/, "BUTTON") : kind.replace(/^BTN$/, "BUTTON");
      else base = signals <= 1 || cs.length > 1 ? code : net;
    }
    base = base.replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
    let name = `${base}_PIN`;
    for (let n = 2; used.has(name); n++) name = `${base}${n}_PIN`;
    used.add(name);
    const toName = (c: Connection) => `${partName(getPart(c.to.partId), "en", c.to.part)} ${c.to.label}`;
    const targets = cs.map(toName);
    const ids = cs.map((c) => c.id);
    out.push({
      name,
      value: boardPinValue(first.from.pin)!,
      connectionIds: ids,
      colour: first.wireColour,
      comment: `${first.wireColour} wire → ${targets.join(", ")} (${ids.join(", ")})`,
    });
  }
  return out;
}

export const PIN_BLOCK_START = "// >>> PINS (from your wiring) >>>";
export const PIN_BLOCK_END = "// <<< PINS <<<";

/** The sketch's pin block: markers + one constant per line. */
export function pinBlock(constants: PinConstant[]): string {
  const w = Math.max(0, ...constants.map((c) => `const int ${c.name} = ${c.value};`.length));
  const lines = constants.map((c) => {
    const decl = `const int ${c.name} = ${c.value};`;
    return `${decl.padEnd(w)}  // ${c.comment}`;
  });
  return [PIN_BLOCK_START, ...lines, PIN_BLOCK_END].join("\n");
}

export type PinBlockUpdate = { code: string; changed: boolean; removed: string[]; added: string[] };

/**
 * Puts `block` into `code`: between the markers when they are there, else
 * after the last #include (or at the top). Nothing else in the code changes.
 */
export function replacePinBlock(code: string, block: string): PinBlockUpdate {
  const lines = code.split("\n");
  const s = lines.findIndex((l) => l.trim() === PIN_BLOCK_START);
  const e = s >= 0 ? lines.findIndex((l, i) => i > s && l.trim() === PIN_BLOCK_END) : -1;
  const blockLines = block.split("\n");
  let before: string[];
  let next: string[];
  if (s >= 0 && e > s) {
    before = lines.slice(s + 1, e);
    next = [...lines.slice(0, s), ...blockLines, ...lines.slice(e + 1)];
  } else {
    before = [];
    let at = 0;
    lines.forEach((l, i) => {
      if (/^\s*#include\b/.test(l)) at = i + 1;
    });
    next = [...lines.slice(0, at), ...(at > 0 ? [""] : []), ...blockLines, "", ...lines.slice(at)];
  }
  const after = blockLines.slice(1, -1);
  const removed = before.filter((l) => !after.includes(l));
  const added = after.filter((l) => !before.includes(l));
  const out = next.join("\n");
  return { code: out, changed: out !== code, removed, added };
}

/** 0-based line numbers in `code` that use a constant (its declaration included). */
export function linesUsing(code: string, name: string): number[] {
  const re = new RegExp(`\\b${name.replace(/[^A-Z0-9_]/gi, "")}\\b`);
  const out: number[] = [];
  code.split("\n").forEach((l, i) => {
    if (re.test(l)) out.push(i);
  });
  return out;
}
