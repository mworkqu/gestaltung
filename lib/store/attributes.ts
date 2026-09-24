// Typed product attributes, per class. The single definition shared by the
// BOM matcher, the rules that derive passives, the analysis contract and the
// admin attribute tool. Stored as parts.attributes / client_inventory_items
// .attributes (migration 0025): { class: "resistor", resistance_ohm: 10000, ... }.
//
// Each field says how a product's value is compared with what a BOM line asks:
//   eq       same value (numbers within 1 %, text case-insensitive)
//   min      the product's value is at least the line's (power, voltage rating)
//   max      the product's value is at most the line's (tolerance, current draw)
//   includes the product's list contains every value the line lists
//   within   the line's value lies inside the product's [min, max] pair
//
// Pure and client-safe.

export type FieldType = "number" | "enum" | "text" | "list";
export type Compare = "eq" | "min" | "max" | "includes" | "within";

export type Field = {
  key: string;
  type: FieldType;
  compare: Compare;
  unit?: string;
  options?: readonly string[];
  /** Counted by the completeness indicator; a product missing it is weak. */
  required?: boolean;
  /** For `within`: the product-side [min, max] keys. */
  range?: [string, string];
};

/** BOM groups (Task 13): where a line sits in the grouped view. */
export const BOM_GROUPS = ["boards", "sensors", "discrete", "consumables", "hardware", "fabrication"] as const;
export type BomGroup = (typeof BOM_GROUPS)[number];

const PACKAGES = ["through_hole", "smd"] as const;

export const CLASSES = {
  board: {
    group: "boards",
    fields: [
      { key: "platform", type: "enum", compare: "eq", required: true, options: ["arduino_uno", "arduino_nano", "arduino_mega", "esp32", "esp8266", "raspberry_pi", "raspberry_pi_pico", "stm32", "other"] },
      { key: "logic_v", type: "number", compare: "eq", unit: "V", required: true },
      { key: "io_count", type: "number", compare: "min" },
      { key: "connectivity", type: "list", compare: "includes", options: ["wifi", "bluetooth", "lora", "usb", "ethernet", "zigbee"] },
    ],
  },
  module: {
    group: "boards",
    fields: [
      { key: "module_type", type: "enum", compare: "eq", required: true, options: ["motor_driver", "relay", "display", "charger", "regulator", "radio", "level_shifter", "amplifier", "rtc", "other"] },
      { key: "logic_v", type: "number", compare: "eq", unit: "V" },
      { key: "channels", type: "number", compare: "min" },
      { key: "current_a", type: "number", compare: "min", unit: "A" },
      { key: "interface", type: "enum", compare: "eq", options: ["analog", "digital", "i2c", "spi", "uart", "pwm", "onewire"] },
    ],
  },
  ic: {
    group: "discrete",
    fields: [
      { key: "function", type: "text", compare: "eq", required: true },
      { key: "supply_v", type: "number", compare: "eq", unit: "V" },
      { key: "package", type: "enum", compare: "eq", options: ["dip", "soic", "other"] },
    ],
  },
  sensor: {
    group: "sensors",
    fields: [
      { key: "measures", type: "enum", compare: "eq", required: true, options: ["temperature", "humidity", "soil_moisture", "distance", "light", "motion", "gas", "pressure", "sound", "current", "voltage", "acceleration", "water_level", "flow", "color", "gps", "touch", "other"] },
      { key: "interface", type: "enum", compare: "eq", required: true, options: ["analog", "digital", "i2c", "spi", "uart", "onewire"] },
      { key: "supply_v", type: "number", compare: "within", unit: "V", range: ["supply_min_v", "supply_max_v"] },
      { key: "supply_min_v", type: "number", compare: "eq", unit: "V" },
      { key: "supply_max_v", type: "number", compare: "eq", unit: "V" },
    ],
  },
  actuator: {
    group: "sensors",
    fields: [
      { key: "actuator_type", type: "enum", compare: "eq", required: true, options: ["servo", "dc_motor", "stepper", "pump", "buzzer", "solenoid", "fan", "vibration"] },
      { key: "voltage_v", type: "number", compare: "eq", unit: "V", required: true },
      { key: "torque_kgcm", type: "number", compare: "min", unit: "kg·cm" },
      { key: "current_a", type: "number", compare: "max", unit: "A" },
    ],
  },
  led: {
    group: "sensors",
    fields: [
      { key: "color", type: "enum", compare: "eq", required: true, options: ["red", "green", "blue", "yellow", "white", "rgb", "other"] },
      { key: "size_mm", type: "number", compare: "eq", unit: "mm" },
      { key: "package", type: "enum", compare: "eq", options: PACKAGES },
    ],
  },
  resistor: {
    group: "discrete",
    fields: [
      { key: "resistance_ohm", type: "number", compare: "eq", unit: "Ω", required: true },
      { key: "tolerance_pct", type: "number", compare: "max", unit: "%" },
      { key: "power_w", type: "number", compare: "min", unit: "W", required: true },
      { key: "package", type: "enum", compare: "eq", options: PACKAGES, required: true },
    ],
  },
  capacitor: {
    group: "discrete",
    fields: [
      { key: "capacitance_f", type: "number", compare: "eq", unit: "F", required: true },
      { key: "voltage_v", type: "number", compare: "min", unit: "V", required: true },
      { key: "dielectric", type: "enum", compare: "eq", options: ["ceramic", "electrolytic", "film", "tantalum"], required: true },
      { key: "package", type: "enum", compare: "eq", options: PACKAGES },
    ],
  },
  diode: {
    group: "discrete",
    fields: [
      { key: "diode_type", type: "enum", compare: "eq", options: ["rectifier", "signal", "schottky", "zener"], required: true },
      { key: "current_a", type: "number", compare: "min", unit: "A" },
      { key: "voltage_v", type: "number", compare: "min", unit: "V" },
      { key: "package", type: "enum", compare: "eq", options: PACKAGES },
    ],
  },
  transistor: {
    group: "discrete",
    fields: [
      { key: "transistor_type", type: "enum", compare: "eq", options: ["npn", "pnp", "n_mosfet", "p_mosfet"], required: true },
      { key: "current_a", type: "number", compare: "min", unit: "A" },
      { key: "voltage_v", type: "number", compare: "min", unit: "V" },
      { key: "package", type: "enum", compare: "eq", options: ["to92", "to220", "sot23", "other"] },
    ],
  },
  switch: {
    group: "discrete",
    fields: [
      { key: "switch_type", type: "enum", compare: "eq", options: ["tactile", "toggle", "slide", "rocker", "limit", "reed"], required: true },
      { key: "package", type: "enum", compare: "eq", options: PACKAGES },
    ],
  },
  header: {
    group: "discrete",
    fields: [
      { key: "connector_type", type: "enum", compare: "eq", options: ["pin_header", "female_header", "screw_terminal", "jst", "dupont"], required: true },
      { key: "pins", type: "number", compare: "min" },
      { key: "pitch_mm", type: "number", compare: "eq", unit: "mm" },
    ],
  },
  power: {
    group: "consumables",
    fields: [
      { key: "power_type", type: "enum", compare: "eq", options: ["battery", "battery_holder", "adapter", "solar_panel", "regulator", "charger", "usb_cable"], required: true },
      { key: "voltage_v", type: "number", compare: "eq", unit: "V" },
      { key: "capacity_mah", type: "number", compare: "min", unit: "mAh" },
      { key: "current_a", type: "number", compare: "min", unit: "A" },
      { key: "cells", type: "number", compare: "eq" },
    ],
  },
  consumable: {
    group: "consumables",
    fields: [
      { key: "consumable_type", type: "enum", compare: "eq", options: ["breadboard", "jumper_wires", "perfboard", "hookup_wire", "heat_shrink", "solder", "usb_cable", "cable_ties", "adhesive", "other"], required: true },
      { key: "size", type: "text", compare: "eq" },
    ],
  },
  fastener: {
    group: "hardware",
    fields: [
      { key: "fastener_type", type: "enum", compare: "eq", options: ["screw", "bolt", "nut", "washer", "standoff", "rivet", "insert"], required: true },
      { key: "thread", type: "enum", compare: "eq", options: ["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"], required: true },
      { key: "length_mm", type: "number", compare: "eq", unit: "mm" },
      { key: "material", type: "text", compare: "eq" },
    ],
  },
} as const satisfies Record<string, { group: BomGroup; fields: readonly Field[] }>;

export type AttrClass = keyof typeof CLASSES;
export const ATTR_CLASSES = Object.keys(CLASSES) as AttrClass[];

export type Attributes = { class?: string } & Record<string, unknown>;

export const isAttrClass = (c: unknown): c is AttrClass => typeof c === "string" && c in CLASSES;

export const fieldsOf = (c: AttrClass): readonly Field[] => CLASSES[c].fields;

/** A product counts as attributed when it has a class and every required field. */
export function isComplete(a: Attributes | null | undefined): boolean {
  if (!a || !isAttrClass(a.class)) return false;
  return fieldsOf(a.class).every((f) => !f.required || hasValue(a[f.key]));
}

export const hasValue = (v: unknown) =>
  v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

const SI = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
] as const;

/** 10000 Ω → "10 kΩ", 0.0000001 F → "100 nF". */
export function formatValue(v: unknown, unit?: string): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v !== "number") return String(v);
  if (unit === "Ω" || unit === "F") {
    const [m, p] = SI.find(([m]) => Math.abs(v) >= m * 0.9999) ?? SI[SI.length - 1];
    const n = v / m;
    return `${Number.isInteger(n) ? n : Number(n.toPrecision(3))} ${p}${unit}`;
  }
  if (unit === "%") return `±${v}%`;
  return unit ? `${v} ${unit}` : String(v);
}

type Verdict = { ok: boolean; known: boolean; why: string };

/** Compares one field of a product with what a line asks. */
export function compareField(f: Field, want: unknown, product: Attributes): Verdict {
  const label = f.key.replace(/_/g, " ");
  if (f.compare === "within" && f.range) {
    const lo = Number(product[f.range[0]]);
    const hi = Number(product[f.range[1]]);
    const w = Number(want);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ok: true, known: false, why: `no supply range on product` };
    const ok = w >= lo - 1e-9 && w <= hi + 1e-9;
    return { ok, known: true, why: `${label} ${formatValue(w, f.unit)} ${ok ? "within" : "outside"} ${lo}–${hi} ${f.unit ?? ""}`.trim() };
  }
  const have = product[f.key];
  if (!hasValue(have)) return { ok: true, known: false, why: `no ${label} on product` };
  let ok: boolean;
  let op: string;
  if (f.type === "number") {
    const a = Number(have);
    const b = Number(want);
    if (f.compare === "min") [ok, op] = [a >= b - 1e-12, "≥"];
    else if (f.compare === "max") [ok, op] = [a <= b + 1e-12, "≤"];
    else [ok, op] = [Math.abs(a - b) <= Math.abs(b) * 0.01 + 1e-15, "="];
  } else if (f.type === "list" || f.compare === "includes") {
    const h = (Array.isArray(have) ? have : [have]).map((x) => String(x).toLowerCase());
    const w = (Array.isArray(want) ? want : [want]).map((x) => String(x).toLowerCase());
    [ok, op] = [w.every((x) => h.includes(x)), "includes"];
  } else {
    [ok, op] = [String(have).toLowerCase() === String(want).toLowerCase(), "="];
  }
  return {
    ok,
    known: true,
    why: `${label} ${formatValue(have, f.unit)} ${ok ? op : "≠"} ${formatValue(want, f.unit)}`,
  };
}

/** Parses a free number like "4.7k", "100n", "10kΩ" into a plain number. */
export function parseEng(s: string): number | null {
  const m = s.trim().match(/^([\d.]+)\s*([pnuµmkKMG]?)/);
  if (!m) return null;
  const mult: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, "": 1 };
  const n = Number(m[1]);
  return Number.isFinite(n) ? n * mult[m[2]] : null;
}

/** Keeps only the class's own fields, with numbers parsed ("10k" → 10000). */
export function cleanAttributes(raw: Attributes): Attributes {
  if (!isAttrClass(raw.class)) return {};
  const out: Attributes = { class: raw.class };
  for (const f of fieldsOf(raw.class)) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "number") {
      const n = typeof v === "number" ? v : parseEng(String(v));
      if (n !== null && Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === "list") {
      const list = (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      if (list.length) out[f.key] = list;
    } else out[f.key] = String(v).trim();
  }
  return out;
}
