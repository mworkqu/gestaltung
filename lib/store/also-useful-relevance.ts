// "Also useful" relevance (P5-04): a product is suggested only when it shares
// a FUNCTION CATEGORY with the project. A desk lamp gets wire, a power
// adapter or a light sensor, never a camera, a soldering iron, a servo or a
// stepper motor. The store categories are too coarse for that (a camera and a
// PIR sensor are both "Sensors"), so the function is read from the words of
// the project's own BOM lines and from the product's name.
//
// Rules, in plain terms:
//   - project categories come from its BOM lines (function + spec), and from
//     the products those lines resolved to;
//   - a candidate's categories come from its name;
//   - a candidate is shown only when it shares one with the project;
//   - a product whose name says nothing recognisable is NOT shown;
//   - tools (soldering irons, multimeters ...) are never suggested;
//   - fewer than two relevant products = no block at all.
//
// Pure and client-safe. Card fields only.

import type { StoreCardPart } from "./catalog";
import { rankInStockFirst, UPSELL_COUNT } from "./bought-together";

export type FunctionCategory =
  | "lighting"
  | "sensing"
  | "switching"
  | "power"
  | "wiring"
  | "display"
  | "audio"
  | "wireless"
  | "controller"
  | "motion"
  | "vision"
  | "enclosure"
  | "tools";

/** Categories that are never inferred from a BOM line and never suggested. */
const NEVER_SUGGESTED: ReadonlySet<FunctionCategory> = new Set(["tools"]);

const WORDS: ReadonlyArray<[FunctionCategory, RegExp]> = [
  ["tools", /solder|multimeter|oscilloscope|tweezer|screwdriver|wire strip|crimp|hot air|desolder|flux|tool kit|helping hand|vise|vice|cutter|plier/i],
  ["vision", /camera|cam module|ov\d{3,4}|esp32-?cam|thermal imag|lens\b/i],
  ["motion", /servo|stepper|\bmotor\b|motor driver|\bpump\b|\bfan\b|blower|actuator|solenoid|gear ?motor|propeller/i],
  ["lighting", /\bled\b|leds\b|lamp|bulb|neopixel|ws2812|light strip|led strip|\blight\b|laser diode|matrix/i],
  ["sensing", /sensor|\bpir\b|ldr|photoresistor|thermistor|\bdht\d*|ds18b20|ultrasonic|\bimu\b|accelerometer|gyro|hall|\btof\b|load cell|detector|encoder|potentiometer|moisture|humidity|temperature/i],
  ["switching", /relay|mosfet|transistor|\bswitch\b|button|toggle|optocoupler|solid state|driver module|rotary/i],
  ["power", /adapter|adaptor|power supply|charger|battery|\bbms\b|buck|boost|voltage regulator|regulator|converter|usb.*power|power bank|solar|dc jack|barrel|\bcell\b|holder.*(battery|18650)|18650|lipo|fuse/i],
  ["wiring", /jumper|dupont|breadboard|hookup|wire\b|cable|connector|header|terminal block|heat shrink|heatshrink|ribbon|perfboard|stripboard|screw terminal|socket/i],
  ["display", /display|lcd|oled|tft|e-?paper|seven.?segment|screen/i],
  ["audio", /buzzer|speaker|piezo|microphone|\bmic\b|amplifier|audio|mp3/i],
  ["wireless", /bluetooth|\bble\b|wifi|wi-fi|lora|nrf24|rf module|\brfid\b|\bnfc\b|zigbee|antenna|gsm|gps/i],
  ["controller", /esp32|esp8266|arduino|microcontroller|raspberry|stm32|\bpico\b|attiny|development board|dev board|\bnano\b|\buno\b/i],
  ["enclosure", /enclosure|\bcase\b|\bbox\b|bracket|standoff|spacer|screw\b|\bnut\b|\bbolt\b|mounting|panel mount|project box/i],
];

/** Function categories a text speaks about (tools included, so a name can be recognised as one). */
export function functionCategoriesOf(text: string | null | undefined): Set<FunctionCategory> {
  const out = new Set<FunctionCategory>();
  const t = text ?? "";
  if (!t.trim()) return out;
  for (const [cat, re] of WORDS) if (re.test(t)) out.add(cat);
  return out;
}

/** The project's function categories, from its lines' own words. Tools are never part of it. */
export function projectFunctionCategories(
  lines: ReadonlyArray<{ function?: string | null; spec?: string | null }>,
  productNames: ReadonlyArray<string | null | undefined> = []
): Set<FunctionCategory> {
  const out = new Set<FunctionCategory>();
  for (const l of lines) for (const c of functionCategoriesOf(`${l.function ?? ""} ${l.spec ?? ""}`)) out.add(c);
  for (const n of productNames) for (const c of functionCategoriesOf(n)) out.add(c);
  for (const c of NEVER_SUGGESTED) out.delete(c);
  return out;
}

/** Whether a product (by its name) shares a function category with the project. */
export function isRelevantSuggestion(
  product: Pick<StoreCardPart, "name" | "name_ar">,
  project: ReadonlySet<FunctionCategory>
): boolean {
  const own = functionCategoriesOf(`${product.name} ${product.name_ar ?? ""}`);
  // A tool is a tool, whatever else its name mentions ("soldering iron kit with LED").
  for (const c of NEVER_SUGGESTED) if (own.has(c)) return false;
  // Something the project does not do (camera for a lamp, servo for a lamp) is out
  // even when the name also names a category the project has ("servo with sensor").
  for (const c of ["vision", "motion"] as const) if (own.has(c) && !project.has(c)) return false;
  for (const c of own) if (project.has(c)) return true;
  return false;
}

/** At least this many relevant products, or the block is not shown. */
export const MIN_ALSO_USEFUL = 2;

/**
 * The "Also useful" list: the pool minus the BOM's SKUs, only products that
 * share a function category with the project, in stock first, at most `limit`;
 * an empty list when fewer than MIN_ALSO_USEFUL qualify.
 */
export function relevantAlsoUseful({
  pool,
  excludeSkus,
  lines,
  productNames = [],
  limit = UPSELL_COUNT,
}: {
  pool: readonly StoreCardPart[];
  excludeSkus: Iterable<string>;
  lines: ReadonlyArray<{ function?: string | null; spec?: string | null }>;
  productNames?: ReadonlyArray<string | null | undefined>;
  limit?: number;
}): StoreCardPart[] {
  const project = projectFunctionCategories(lines, productNames);
  if (project.size === 0) return [];
  const seen = new Set(excludeSkus);
  const kept = pool.filter((p) => {
    if (seen.has(p.sku)) return false;
    seen.add(p.sku);
    return isRelevantSuggestion(p, project);
  });
  const picked = rankInStockFirst(kept).slice(0, limit);
  return picked.length >= MIN_ALSO_USEFUL ? picked : [];
}
