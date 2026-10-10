// Plain names for the client's wiring picture (client view, P5-04).
//
// The netlist speaks in designators and pin names (U1, GPIO23, PIR_SIG, VIN).
// A client should read "Motion sensor", "Lamp relay", "Power adapter" instead.
// The words come from the part's own human name (the BOM function the model
// wrote for the component), never from the designator. First rule that
// matches wins, so the order below matters (a "relay module" is a relay, not a
// module; a "light sensor" is a sensor, not a light).
//
// Pure and client-safe. Arabic is natural Arabic; nothing here is uppercase or
// letter-spaced.

import { humanPartName } from "./human-name";
import { powerNets, type Netlist, type PinType } from "./netlist";

export type PlainLocale = "en" | "ar";

export type PlainKind =
  | "lampRelay"
  | "relay"
  | "levelShift"
  | "motionSensor"
  | "soilSensor"
  | "humiditySensor"
  | "temperatureSensor"
  | "distanceSensor"
  | "lightSensor"
  | "sensor"
  | "powerAdapter"
  | "solarPanel"
  | "battery"
  | "statusLight"
  | "lightStrip"
  | "light"
  | "resistor"
  | "capacitor"
  | "diode"
  | "transistor"
  | "buzzer"
  | "button"
  | "display"
  | "pump"
  | "fan"
  | "motor"
  | "valve"
  | "camera"
  | "mainBoard"
  | "part";

const NAMES: Record<PlainKind, { en: string; ar: string }> = {
  lampRelay: { en: "Lamp relay", ar: "مرحّل المصباح" },
  relay: { en: "Relay", ar: "مرحّل" },
  levelShift: { en: "Voltage adapter", ar: "محوّل الجهد" },
  motionSensor: { en: "Motion sensor", ar: "مستشعر الحركة" },
  soilSensor: { en: "Soil moisture sensor", ar: "مستشعر رطوبة التربة" },
  humiditySensor: { en: "Humidity sensor", ar: "مستشعر الرطوبة" },
  temperatureSensor: { en: "Temperature sensor", ar: "مستشعر الحرارة" },
  distanceSensor: { en: "Distance sensor", ar: "مستشعر المسافة" },
  lightSensor: { en: "Light sensor", ar: "مستشعر الضوء" },
  sensor: { en: "Sensor", ar: "مستشعر" },
  powerAdapter: { en: "Power adapter", ar: "محوّل الطاقة" },
  solarPanel: { en: "Solar panel", ar: "لوح شمسي" },
  battery: { en: "Battery", ar: "بطارية" },
  statusLight: { en: "Status light", ar: "ضوء الحالة" },
  lightStrip: { en: "Light strip", ar: "شريط إضاءة" },
  light: { en: "Light", ar: "إضاءة" },
  resistor: { en: "Resistor", ar: "مقاومة" },
  capacitor: { en: "Capacitor", ar: "مكثّف" },
  diode: { en: "Protection diode", ar: "صمّام حماية" },
  transistor: { en: "Switch transistor", ar: "ترانزستور تبديل" },
  buzzer: { en: "Buzzer", ar: "جرس" },
  button: { en: "Button", ar: "زر" },
  display: { en: "Display", ar: "شاشة" },
  pump: { en: "Water pump", ar: "مضخة ماء" },
  fan: { en: "Fan", ar: "مروحة" },
  motor: { en: "Motor", ar: "محرّك" },
  valve: { en: "Valve", ar: "صمّام" },
  camera: { en: "Camera", ar: "كاميرا" },
  mainBoard: { en: "Main board", ar: "اللوحة الرئيسية" },
  part: { en: "Part", ar: "قطعة" },
};

/** Ordered rules over the lower-cased text. */
const RULES: ReadonlyArray<[RegExp, PlainKind | ((t: string) => PlainKind)]> = [
  [/relay|مرحّل|مرحل/, (t) => (/lamp|light|bulb|مصباح|إضاءة/.test(t) ? "lampRelay" : "relay")],
  [/level.?shift|logic.?level|voltage.?(convert|translat)|bi-?directional.*convert/, "levelShift"],
  [/\bpir\b|motion|presence|occupancy|حركة/, "motionSensor"],
  [/soil|moisture|تربة/, "soilSensor"],
  [/humidity|رطوبة/, (t) => (/temperature|dht|حرارة/.test(t) ? "temperatureSensor" : "humiditySensor")],
  [/temperature|thermistor|\bdht\d*|ds18b20|thermo|حرارة/, "temperatureSensor"],
  [/ultrasonic|distance|range finder|\btof\b|مسافة/, "distanceSensor"],
  [/\bldr\b|photo(resistor|diode|cell)|ambient|\blux\b|light.?(sensor|dependent)|ضوء/, "lightSensor"],
  [/sensor|مستشعر|حساس/, "sensor"],
  [/solar|شمسي/, "solarPanel"],
  [/power (adapter|adaptor|supply)|\badap[t]?er\b|charger|\bpsu\b|wall|usb.*(power|supply)|supply|محوّل|شاحن/, "powerAdapter"],
  [/batter|\bcell\b|18650|lipo|li-?ion|بطارية/, "battery"],
  [/status.*led|indicator|مؤشر/, "statusLight"],
  [/led strip|light strip|neopixel|ws2812|شريط/, "lightStrip"],
  [/\bled\b|lamp|bulb|\blight\b|مصباح|إضاءة/, "light"],
  [/resistor|مقاومة/, "resistor"],
  [/capacitor|مكثف/, "capacitor"],
  [/diode|صمام ثنائي/, "diode"],
  [/transistor|mosfet|ترانزستور/, "transistor"],
  [/buzzer|speaker|piezo|جرس/, "buzzer"],
  [/button|switch|push|toggle|زر|مفتاح/, "button"],
  [/display|lcd|oled|screen|شاشة/, "display"],
  [/pump|مضخة/, "pump"],
  [/\bfan\b|blower|مروحة/, "fan"],
  [/valve|solenoid|صمام/, "valve"],
  [/motor|servo|stepper|محرك/, "motor"],
  [/camera|كاميرا/, "camera"],
  [/esp-?32|esp-?8266|arduino|microcontroller|controller|raspberry|stm32|\bpico\b|\bmcu\b|dev(elopment)?.?board|main board|\bboard\b|لوحة/, "mainBoard"],
];

/** What kind of part a human name describes ("part" when it says nothing useful). */
export function plainKindOf(text: string | null | undefined): PlainKind {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return "part";
  for (const [re, kind] of RULES) {
    if (re.test(t)) return typeof kind === "function" ? kind(t) : kind;
  }
  return "part";
}

/** A designator or snake_case id, i.e. not something a person would write. */
const LOOKS_LIKE_ID = /^[a-z]{1,4}([_-][a-z]{1,4})?[_-]?\d+[a-z]?$/i;

/**
 * The plain name of one part, from its human name. A name that matches no
 * known kind is shown as the first words of the name itself, never as a
 * designator ("U1", "Q2", "R_LED1").
 */
export function plainPartName(name: string | null | undefined, locale: PlainLocale = "en"): string {
  const kind = plainKindOf(name);
  if (kind !== "part") return NAMES[kind][locale];
  const raw = humanPartName((name ?? "").trim());
  if (!raw || LOOKS_LIKE_ID.test(raw)) return NAMES.part[locale];
  // First three words, no spec numbers ("5V", "220 ohm") or punctuation tails.
  const words = raw
    .replace(/[(),;:/]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+(\.\d+)?[a-zµΩ%]*$/i.test(w))
    .slice(0, 3);
  if (!words.length) return NAMES.part[locale];
  const text = words.join(" ");
  return locale === "en" ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Plain labels for every component of a netlist, by designator. Two parts that
 * read the same get a number ("Light", "Light 2") so the picture stays clear.
 */
export function plainComponentLabels(
  components: ReadonlyArray<{ ref: string; function: string }>,
  locale: PlainLocale = "en"
): Map<string, string> {
  const base = components.map((c) => ({ ref: c.ref, label: plainPartName(c.function, locale) }));
  const total = new Map<string, number>();
  for (const b of base) total.set(b.label, (total.get(b.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const b of base) {
    const n = (seen.get(b.label) ?? 0) + 1;
    seen.set(b.label, n);
    out.set(b.ref, (total.get(b.label) ?? 0) > 1 && n > 1 ? `${b.label} ${n}` : b.label);
  }
  return out;
}

export type PlainWords = {
  /** "Power", "Ground", "Signal", "Connection": for pins and wires. */
  power: string;
  ground: string;
  signal: string;
  connection: string;
};

/** A pin's plain word from its type: never GPIO23 or VIN. */
export function plainPinLabel(type: PinType, words: PlainWords): string {
  if (type === "power_in" || type === "power_out") return words.power;
  if (type === "ground") return words.ground;
  if (type === "passive") return words.connection;
  return words.signal;
}

/**
 * Plain wire names for every net: the supply wires are "Power" and "Ground";
 * a signal wire is named for the part at its far end ("Signal · Motion sensor").
 * The part that supplies power (the board) is not used as the name.
 */
export function plainNetLabels(
  n: Netlist,
  componentLabels: Map<string, string>,
  words: PlainWords
): Map<string, string> {
  const { power, ground } = powerNets(n);
  const sources = new Set(n.powerRails.map((r) => r.sourceRef));
  const out = new Map<string, string>();
  const used = new Map<string, number>();
  for (const net of n.nets) {
    let label: string;
    if (ground.has(net.name)) label = words.ground;
    else if (power.has(net.name)) label = words.power;
    else {
      const far = net.connections.find((c) => !sources.has(c.ref)) ?? net.connections[0];
      const name = far ? componentLabels.get(far.ref) : undefined;
      label = name ? `${words.signal} · ${name}` : words.signal;
    }
    const k = (used.get(label) ?? 0) + 1;
    used.set(label, k);
    out.set(net.name, k > 1 ? `${label} ${k}` : label);
  }
  return out;
}
