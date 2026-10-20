// The idea card → the parts it promises (owner, 2026-10-18). Pure.
//
// Every sensor, output and mover on the card ("Our understanding" + the card's
// outputs/inputs) maps to a library part, so the parts list can never drop what
// the card shows ("3 LEDs" → 3 × led_5mm; the wiring then adds a resistor each).
// enforcePick() adds what the model left out; cardCoverage() is the check
// (card items ⊆ parts) used by tests and the Parts step.
// Items we cannot map to a library part (a stepper, a linear actuator, an
// unknown name) are left out of the check rather than guessed.

import { classFor } from "./build-class";
import type { ProductSpec, StudioComponent } from "./schema";
import { coloursIn, type PartColour } from "./variants";

export type CardItem = {
  /** Stable key, e.g. "led", "soil". */
  key: string;
  /** Library ids that satisfy it; the first one present in the library is added. */
  ids: readonly string[];
  count: number;
  /** Colours named on the card, in order ("Green, yellow, and red LEDs" → green, yellow, red). */
  colours?: PartColour[];
};

type Rule = { key: string; re: RegExp; ids: readonly string[] };

const SENSOR_RULES: Rule[] = [
  { key: "soil", re: /soil|moist|تربة/i, ids: ["soil_moisture_cap"] },
  { key: "probe", re: /probe|ds18|water temp|liquid|مسبار/i, ids: ["ds18b20"] },
  { key: "climate", re: /temp|humid|weather|climate|dht|حرار|رطوبة/i, ids: ["dht22", "ds18b20"] },
  { key: "distance", re: /distance|ultrason|range|sonar|hc-?sr04|مسافة/i, ids: ["hcsr04"] },
  { key: "motion", re: /motion|pir|presence|movement|حركة|وجود/i, ids: ["pir_hcsr501"] },
  { key: "light_sensor", re: /light|lux|bright|ldr|photo|ضوء|إضاءة|سطوع/i, ids: ["ldr_module", "bh1750"] },
  { key: "imu", re: /accel|gyro|tilt|imu|mpu|orientation|ميل|تسارع/i, ids: ["mpu6050"] },
  { key: "button", re: /button|push|زر/i, ids: ["button_6mm"] },
  // After `button` on purpose: ruleFor() takes the FIRST match, and a "push button switch"
  // is a button, not a toggle. A named DIP switch block comes before the generic toggle so
  // "4-way DIP switch" is not answered with four slide switches.
  { key: "dip_switch", re: /\bdip[- ]?switch(?:es)?\b|\bdil switch/i, ids: ["dip_switch_4", "slide_switch"] },
  { key: "switch", re: /switch|toggle|slider|spdt|\bsp[ds]t\b|مفتاح|مفاتيح/i, ids: ["slide_switch", "dip_switch_4"] },
  { key: "knob", re: /knob|rotary|encoder|dial|مقبض/i, ids: ["rotary_encoder"] },
  { key: "clock", re: /clock|rtc|real.?time|ساعة/i, ids: ["rtc_ds3231"] },
];

/**
 * 7400-series gate chips (2026-10-20). Checked LAST, after the sensor and output rules, so
 * an output named "LED showing the AND gate output" stays an LED; a chip's own name
 * ("AND gate (7408)") matches no sensor or output rule and lands here.
 *
 * NAND / NOR / XOR come first even though "\band gate\b" cannot match inside "NAND gate"
 * (there is no word boundary between the N and the a) — a future widening stays safe.
 * The bare English word "nor" is deliberately NOT a match ("neither … nor …" in a purpose
 * sentence is not a chip); "nand" and "xor" are not English words, so they are.
 */
const GATE_RULES: Rule[] = [
  { key: "gate_nand", re: /\b74(?:hc|hct|ls|f|s|als)?00\b(?!\s*-?\s*series)|\bnand\b/i, ids: ["ic_7400"] },
  { key: "gate_nor", re: /\b74(?:hc|hct|ls|f|s|als)?02\b|\bnor[- ](?:gate|chip|ic)s?\b/i, ids: ["ic_7402"] },
  { key: "gate_xor", re: /\b74(?:hc|hct|ls|f|s|als)?86\b|\b(?:xor|exclusive[- ]or)\b/i, ids: ["ic_7486"] },
  { key: "gate_and", re: /\b74(?:hc|hct|ls|f|s|als)?08\b|\band[- ](?:gate|chip|ic)s?\b|بوابة\s*and/i, ids: ["ic_7408"] },
  { key: "gate_or", re: /\b74(?:hc|hct|ls|f|s|als)?32\b|\bor[- ](?:gate|chip|ic)s?\b|بوابة\s*or/i, ids: ["ic_7432"] },
  {
    key: "gate_not",
    re: /\b74(?:hc|hct|ls|f|s|als)?04\b|\b(?:not|inverter|inverting)[- ](?:gate|chip|ic)s?\b|\binverter\b|بوابة\s*not/i,
    ids: ["ic_7404"],
  },
];

/** Every gate chip, in the order a logic build gets them. */
const GATE_IDS: readonly string[] = GATE_RULES.flatMap((r) => r.ids);

/**
 * The boards that can BE the controller. Any of them satisfies the card's controller
 * promise (the picker's "exactly one mcu" rule decides which); the card's own words only
 * say which one leads, so a card that names an Uno is not "missing" its controller when
 * the picker chose the C3.
 */
const MCU_IDS: readonly string[] = ["esp32_devkit", "esp32_c3_mini", "arduino_uno", "arduino_nano", "pico_w"];
const CONTROLLER_RULES: Rule[] = [
  { key: "controller", re: /esp32[\s-]?c3|c3[\s-]?mini/i, ids: ["esp32_c3_mini"] },
  { key: "controller", re: /esp-?32|esp-?8266|wemos|d1 mini/i, ids: ["esp32_devkit"] },
  { key: "controller", re: /nano/i, ids: ["arduino_nano"] },
  { key: "controller", re: /uno|arduino|atmega/i, ids: ["arduino_uno"] },
  { key: "controller", re: /pico|rp2040|raspberry/i, ids: ["pico_w"] },
];

/** The board the card names first, then every other board that would also do. */
function controllerIds(text: string): readonly string[] {
  const named = ruleFor(CONTROLLER_RULES, text)?.ids ?? [];
  return [...named, ...MCU_IDS.filter((id) => !named.includes(id))];
}

const OUTPUT_RULES: Rule[] = [
  { key: "ring", re: /ring|rgb|neopixel|strip|ws2812|حلقة|شريط/i, ids: ["ws2812_ring"] },
  { key: "led", re: /led|light|lamp|indicator|ضوء|أضواء|مصباح|ليد|لمبة/i, ids: ["led_5mm"] },
  { key: "lcd", re: /lcd|16x2|1602/i, ids: ["lcd1602_i2c", "oled_096_i2c", "oled_13_i2c"] },
  { key: "screen", re: /oled|screen|display|شاشة/i, ids: ["oled_096_i2c", "oled_13_i2c", "lcd1602_i2c"] },
  { key: "buzzer", re: /buzz|beep|alarm|صفار|طنان|جرس|إنذار/i, ids: ["buzzer"] },
  { key: "speaker", re: /speaker|sound|audio|music|سماعة|صوت/i, ids: ["speaker_amp"] },
  { key: "relay", re: /relay|ريليه|مرحل/i, ids: ["relay_module"] },
  { key: "sd", re: /sd card|micro ?sd|logger|data log|بطاقة/i, ids: ["microsd_module"] },
];

const MOVER_IDS: Record<string, readonly string[]> = {
  pump: ["pump_5v"],
  motor: ["n20_motor"],
  servo: ["sg90_servo", "mg996r_servo"],
};

/** The card's enums, when the understanding does not already name them. */
const OUTPUT_ENUM: Record<string, string> = { screen: "screen", led: "led", buzzer: "buzzer", speaker: "speaker", relay: "relay" };
const INPUT_ENUM: Record<string, string> = { button: "button", knob: "knob" };

const ruleFor = (rules: Rule[], text: string) => rules.find((r) => r.re.test(text));

/** An output that is a light (an LED or a light ring), for the "3 lights" tally. */
export const isLight = (name: string) => {
  const r = ruleFor(OUTPUT_RULES, name);
  return r?.key === "led" || r?.key === "ring";
};

export function cardItems(spec: ProductSpec): CardItem[] {
  const items = new Map<string, CardItem>();
  const put = (key: string, ids: readonly string[], count: number, colours: PartColour[] = []) => {
    const cur = items.get(key);
    const all = [...(cur?.colours ?? []), ...colours];
    items.set(key, {
      key,
      ids,
      count: Math.max(cur?.count ?? 0, Math.max(1, Math.round(count))),
      ...(all.length ? { colours: all } : {}),
    });
  };
  const u = spec.understanding;
  const cls = classFor(spec);
  // The controller the card promises (2026-10-20). Before this the coverage check had a
  // hole exactly here: whatever the card called its brain was never checked against the
  // parts. A logic build has no microcontroller at all — its "brain" IS the gate chips,
  // so the same promise is satisfied by any 7400-series chip. A cad build promises none.
  if (cls === "logic") put("controller", GATE_IDS, 1);
  else if (cls === "mcu" && (u?.controller ?? "").trim()) put("controller", controllerIds(u!.controller), 1);
  for (const s of u?.sensors ?? []) {
    const t = `${s.name} ${s.purpose ?? ""}`;
    const r = ruleFor(SENSOR_RULES, t) ?? ruleFor(GATE_RULES, t);
    if (r) put(r.key, r.ids, s.count);
  }
  for (const o of u?.outputs ?? []) {
    const t = `${o.name} ${o.purpose ?? ""}`;
    const r = ruleFor(OUTPUT_RULES, o.name) ?? ruleFor(OUTPUT_RULES, t) ?? ruleFor(GATE_RULES, t);
    if (r) put(r.key, r.ids, o.count, r.key === "led" ? coloursIn(t) : []);
  }
  for (const a of u?.actuators ?? []) {
    const ids = MOVER_IDS[a.kind];
    if (ids) put(a.kind, ids, a.count);
  }
  // The card's own enums (older cards have no understanding).
  for (const o of spec.outputs) {
    const key = OUTPUT_ENUM[o];
    if (key && !items.has(key) && !(key === "screen" && items.has("lcd")) && !(key === "led" && items.has("ring"))) {
      const r = OUTPUT_RULES.find((x) => x.key === key)!;
      put(key, r.ids, 1);
    }
    // "motor" on a card with servos (an arm, a feeder) means those servos, not a DC motor.
    const movers = (spec.actuators?.length ?? 0) > 0 || (u?.actuators.length ?? 0) > 0;
    if (o === "pump" && !items.has("pump")) put("pump", MOVER_IDS.pump, 1);
    // A bare "motor" is satisfied by any mover already chosen (a feeder's servo counts).
    if (o === "motor" && !movers && !items.has("motor")) put("motor", ["n20_motor", "sg90_servo", "mg996r_servo", "pump_5v"], 1);
  }
  for (const i of spec.inputs) {
    const key = INPUT_ENUM[i];
    if (key && !items.has(key)) put(key, SENSOR_RULES.find((x) => x.key === key)!.ids, 1);
  }
  return [...items.values()];
}

/**
 * Colour per instance of a coloured card item: the n-th LED gets the n-th colour named
 * ("green, yellow, red" × 3); with one colour named, every LED is that colour.
 */
export function colourForInstance(item: CardItem, n: number): PartColour | undefined {
  const cs = item.colours ?? [];
  if (!cs.length) return undefined;
  return cs.length === 1 ? cs[0] : cs[n];
}

/** Gives each coloured card item's instances their colours (keeps colours already set). */
export function applyCardColours<T extends { partId: string; variant?: string }>(spec: ProductSpec, components: T[]): T[] {
  const out = components.map((c) => ({ ...c }));
  for (const item of cardItems(spec)) {
    if (!item.colours?.length) continue;
    let n = 0;
    for (const c of out) {
      if (!item.ids.includes(c.partId)) continue;
      const colour = colourForInstance(item, n++);
      if (colour && !c.variant) c.variant = colour;
    }
  }
  return out;
}

/**
 * Every library id a sensor / output / gate card item can stand for.
 *
 * The controller ids are deliberately NOT in here: boards are never dropped by offCard()
 * (a card with an empty controller line would otherwise lose its board entirely). The gate
 * chips ARE, so an mcu build never keeps a 7400 chip the card never named — on a logic
 * build the controller item carries every gate id, so none of them is ever "off card".
 *
 * The SWITCH ids are excluded too (owner, 2026-10-20). A card rarely spells out a power
 * switch, so listing them here would make offCard() silently delete a perfectly good
 * on/off switch from every existing mcu build whose card has a full understanding — a
 * behaviour change nobody asked for, in the name of a feature about logic kits. Coverage
 * is unaffected: cardCoverage() reads cardItems(), not this set, so "Toggle Switches ×2"
 * is still promised and still added.
 */
const SWITCH_IDS = new Set(["slide_switch", "dip_switch_4"]);
const CARD_IDS = new Set(
  [...SENSOR_RULES, ...OUTPUT_RULES, ...GATE_RULES].flatMap((r) => r.ids).filter((id) => !SWITCH_IDS.has(id)),
);

/**
 * Sensors and outputs the picker added that the card never mentions (an LED ring when
 * the card says "3 LEDs"): with a full understanding, the card decides. Helpers,
 * boards, power and movers are never dropped here.
 */
export function offCard(spec: ProductSpec, partId: string): boolean {
  if (!spec.understanding || !CARD_IDS.has(partId)) return false;
  return !cardItems(spec).some((i) => i.ids.includes(partId));
}

export type Missing = { key: string; want: number; have: number };

/** Card items ⊆ parts: what the parts list still lacks (only items the library can satisfy). */
export function cardCoverage(
  spec: ProductSpec,
  components: readonly Pick<StudioComponent, "partId">[],
  inLibrary: (id: string) => boolean = () => true,
): Missing[] {
  const missing: Missing[] = [];
  for (const item of cardItems(spec)) {
    if (!item.ids.some(inLibrary)) continue;
    const have = components.filter((c) => item.ids.includes(c.partId)).length;
    // Servos: the actuator rules decide the exact mix (light / strong); presence is the promise.
    const want = item.key === "servo" ? Math.min(item.count, 1) : item.count;
    if (have < want) missing.push({ key: item.key, want, have });
  }
  return missing;
}
