// Type and key attributes read from a product's NAME (P5-01). Deterministic,
// pure and client-safe: the same name always gives the same answer.
//
// The live catalogue has almost no typed attributes, so the BOM matcher used
// to fall back to word overlap ("PIR motion sensor" → "Limit Switch Module").
// This parser gives every product a class (lib/store/attributes CLASSES) and
// the attributes its name states: sensor kind, resistance, voltage, LED colour,
// pack size … Owner-entered attributes always win (effectiveAttributes); the
// parse only fills what is missing. The admin attribute page can save the
// parse ("Fill from names") so the owner can review and edit it.
//
// Class = the LAST class noun in the product's head (the name before its first
// " – ", comma or bracket, with "for …" and "Clearance Sale:" removed): "Limit
// Switch Module" is a switch, "IR Line Tracking Sensor Module" is a sensor,
// "Clear Water Tube for Water Pump" is no class at all. Generic words (module,
// board, kit) never decide. The fields then come from the whole name.

import { isAttrClass, type AttrClass, type Attributes } from "./attributes";

export type NamedProduct = {
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
};

export type Derived = { attributes: Attributes; packSize: number | null };

// ---------------------------------------------------------------------------
// numbers

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s.replace(",", ".")));

/** "5V", "3.3 V", "12V DC"; null when none or several different ones. */
export function singleVolt(s: string): number | null {
  const found = new Set<number>();
  for (const m of s.matchAll(/(?:^|[^\d.\-–~])(\d+(?:\.\d+)?)\s?v(?:olts?|dc|ac)?\b/gi)) found.add(num(m[1]));
  return found.size === 1 ? [...found][0] : null;
}

/** "3.3–5.5V", "4.5-20 V", "3V–18V", "2.7 to 12V" → [min, max]. */
export function voltRange(s: string): [number, number] | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s?v?\s?(?:–|—|-|~|to)\s?(\d+(?:\.\d+)?)\s?v(?:dc|olts?)?\b/i);
  if (!m) return null;
  const a = num(m[1]);
  const b = num(m[2]);
  return a < b ? [a, b] : null;
}

const MULT: Record<string, number> = { "": 1, r: 1, R: 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12 };

/** Resistance in the name: "10 kΩ", "330 Ω", "4K7", "10K Ohm". Null when none, a range or several. */
export function parseOhms(s: string, bareK = false): number | null {
  if (/\b(?:to|values?|range)\b.*\d\s?[kKM]?\s?(?:Ω|ohm)/i.test(s) || /\d\s?[kKM]?Ω?\s?(?:–|-|to)\s?\d+\s?[kKM]?\s?(?:Ω|ohm)/i.test(s))
    return null;
  const found = new Set<number>();
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?([kKM]?)\s?(?:Ω|ohms?\b)/g)) found.add(num(m[1]) * MULT[m[2]]);
  for (const m of s.matchAll(/\b(\d+)([kKRM])(\d+)\b/g)) found.add(Number(`${m[1]}.${m[3]}`) * MULT[m[2]]);
  if (bareK && !found.size)
    for (const m of s.matchAll(/\b(\d+(?:\.\d+)?)([kKM])\b(?!\s*(?:pcs|pieces|pack))/g)) found.add(num(m[1]) * MULT[m[2]]);
  const vals = [...found].map((v) => Number(v.toPrecision(6)));
  return new Set(vals).size === 1 ? vals[0] : null;
}

/** Capacitance: "100 nF", "470 µF", "10uF". */
export function parseFarads(s: string): number | null {
  const found = new Set<number>();
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?([pnuµm])F\b/g)) found.add(Number((num(m[1]) * MULT[m[2]]).toPrecision(6)));
  return found.size === 1 ? [...found][0] : null;
}

/** Pieces per listing: "(5 Pack)", "pack of 10", "20 Pieces", "5 Pcs", "4 Pieces Pack". */
export function parsePack(name: string): number | null {
  const m =
    name.match(/\bpack of (\d+)\b/i) ??
    name.match(/\b(\d+)\s?(?:pcs|pieces|pc|pack)\b/i) ??
    name.match(/\((\d+)\s?(?:x|pack)\)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 1 && n <= 1000 ? n : null;
}

const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** The nearest standard E12 value (in log terms): 118 → 120, 4600 → 4700, 9500 → 10000. */
export function nearestE12(r: number): number {
  if (!(r > 0) || !Number.isFinite(r)) return r;
  const exp = Math.floor(Math.log10(r));
  let best = r;
  let gap = Infinity;
  for (const e of [exp - 1, exp, exp + 1])
    for (const m of E12) {
      const v = Number((m * 10 ** e).toPrecision(3));
      const d = Math.abs(Math.log(v / r));
      if (d < gap - 1e-12) [best, gap] = [v, d];
    }
  return best;
}

// ---------------------------------------------------------------------------
// the product's head and its class noun

/** The name before its first " – ", " - ", comma or bracket, without "for …" or a sale prefix. */
export function headNoun(name: string): string {
  return name
    .replace(/^\s*clearance sale:\s*/i, "")
    .split(/\s[–—-]\s|,\s|\(/)[0]
    .replace(/\s+(?:for|with)\s.*$/i, "")
    .trim();
}

type Rule = { cls: AttrClass; re: RegExp; set?: Record<string, unknown> };

// Each rule names a class noun. The match that ENDS last in the head wins (the
// head noun in English is the last one); on a tie the longer match wins.
const CLASS_RULES: Rule[] = [
  // modules (before their generic nouns)
  { cls: "module", re: /\brelays?\b/gi, set: { module_type: "relay" } },
  { cls: "module", re: /\b(?:motor driver|h-?bridge|l298n?|l293d?|drv88\d\d|a4988|tb6612\w*)\b/gi, set: { module_type: "motor_driver" } },
  { cls: "module", re: /\b(?:level (?:shifter|converter|translator)|logic level(?: converter| shifter)?|txs0108\w*|bss138)\b/gi, set: { module_type: "level_shifter" } },
  { cls: "module", re: /\b(?:lcd|oled|tft|e-?paper|displays?|7-?segment|led matrix)\b/gi, set: { module_type: "display" } },
  { cls: "module", re: /\b(?:tp4056|charging module|charger module)\b/gi, set: { module_type: "charger" } },
  { cls: "module", re: /\b(?:regulator|buck(?: converter)?|boost(?: converter)?|step-?(?:down|up)|lm2596|ams1117|ldo|breadboard power supply)\b/gi, set: { module_type: "regulator" } },
  { cls: "module", re: /\b(?:rtc|ds3231|ds1307|real time clock)\b/gi, set: { module_type: "rtc" } },
  { cls: "module", re: /\b(?:amplifier|pam8403|lm386)\b/gi, set: { module_type: "amplifier" } },
  { cls: "module", re: /\b(?:nrf24\w*|lora|rf module|433 ?mhz|hc-?0[56])\b/gi, set: { module_type: "radio" } },
  // boards
  {
    cls: "board",
    re: /\b(?:development board|dev ?board|microcontroller(?: board)?|devkit\w*|dev kit|nodemcu|wroom\S*|arduino (?:uno|nano|mega|leonardo|micro)(?: r\d| rev\d)?|raspberry pi (?:[1-5][ab]?\+?|pico\w*|zero\w*)(?: model \w+)?(?!\s?mm)|stm32\w*|blue ?pill)\b/gi,
  },
  // sensors
  {
    cls: "sensor",
    re: /\b(?:sensors?|detectors?|pir|ldr|photoresistors?|photocells?|light dependent resistor|phototransistor|photodiode|thermistor|thermocouple|load cell|accelerometer|gyro\w*|magnetometer|imu|lidar|microphone|mmwave|radar)\b/gi,
  },
  // actuators
  { cls: "actuator", re: /\bservos?\b/gi, set: { actuator_type: "servo" } },
  { cls: "actuator", re: /\bstepper(?: motor)?\b/gi, set: { actuator_type: "stepper" } },
  { cls: "actuator", re: /\bvibration motor\b/gi, set: { actuator_type: "vibration" } },
  { cls: "actuator", re: /\b(?:dc |gear |geared )?motors?\b/gi, set: { actuator_type: "dc_motor" } },
  { cls: "actuator", re: /(?<!desoldering )\bpumps?\b/gi, set: { actuator_type: "pump" } },
  { cls: "actuator", re: /\bbuzzers?\b/gi, set: { actuator_type: "buzzer" } },
  { cls: "actuator", re: /\bsolenoids?\b/gi, set: { actuator_type: "solenoid" } },
  { cls: "actuator", re: /\b(?:cooling )?fans?\b/gi, set: { actuator_type: "fan" } },
  // discrete
  { cls: "led", re: /\bleds?\b/gi },
  { cls: "resistor", re: /(?<!(?:sensitive|variable|dependent|built-in) )\bresistors?\b/gi },
  { cls: "capacitor", re: /\bcapacitors?\b/gi },
  { cls: "diode", re: /(?<!light emitting |photo)\b(?:diodes?|rectifier|zener|schottky|1n400\d|1n4148|1n58\d\d)\b/gi },
  { cls: "transistor", re: /\b(?:transistors?|mosfets?|npn|pnp|darlington|2n2222\w*|bc547\w*|tip12\d|irlz44\w*|irf5[24]0\w*|2n7000)\b/gi },
  { cls: "ic", re: /\b(?:ic|chip|timer|op-?amp|optocoupler|shift register|logic gate|inverter|nand gate|ne555\w*)\b/gi },
  { cls: "switch", re: /\b(?:switch(?:es)?|push ?buttons?|buttons?|tactile)\b/gi },
  { cls: "header", re: /\b(?:pin headers?|headers?|screw terminal(?: block)?|terminal blocks?|jst\w*|dupont connectors?)\b/gi },
  // power
  { cls: "power", re: /\b(?:battery|batteries|18650|lipo|li-?ion cell)\b/gi, set: { power_type: "battery" } },
  { cls: "power", re: /\bbattery (?:holder|box|case|clip)s?\b/gi, set: { power_type: "battery_holder" } },
  { cls: "power", re: /\b(?:power adapter|ac\/dc(?: switching)? (?:power )?adapter|power supply|psu|wall adapter|adapter)\b/gi, set: { power_type: "adapter" } },
  { cls: "power", re: /\bsolar panels?\b/gi, set: { power_type: "solar_panel" } },
  { cls: "power", re: /\bchargers?\b/gi, set: { power_type: "charger" } },
  { cls: "power", re: /\busb\b[^–—]*\bcables?\b/gi, set: { power_type: "usb_cable" } },
  // consumables
  { cls: "consumable", re: /\bbreadboards?\b/gi, set: { consumable_type: "breadboard" } },
  { cls: "consumable", re: /\bjumper wires?\b|\bjumpers\b/gi, set: { consumable_type: "jumper_wires" } },
  { cls: "consumable", re: /\b(?:perfboard|strip ?board|proto(?:type)? ?(?:pcb|board))s?\b/gi, set: { consumable_type: "perfboard" } },
  { cls: "consumable", re: /\b(?:hook-?up wire|\d+ ?awg wire|solid core wire)\b/gi, set: { consumable_type: "hookup_wire" } },
  { cls: "consumable", re: /\bheat ?shrink(?: tub(?:e|ing))?\b/gi, set: { consumable_type: "heat_shrink" } },
  { cls: "consumable", re: /\bsolder(?: wire)?\b(?!less)/gi, set: { consumable_type: "solder" } },
  { cls: "consumable", re: /\bcable ties?\b/gi, set: { consumable_type: "cable_ties" } },
  { cls: "consumable", re: /\b(?:glue|epoxy|adhesive)\b/gi, set: { consumable_type: "adhesive" } },
  // fasteners
  { cls: "fastener", re: /(?<!\b(?:lead|set|thumb) )\bscrews?\b(?!\s*(?:driver|terminal))/gi, set: { fastener_type: "screw" } },
  { cls: "fastener", re: /\bbolts?\b/gi, set: { fastener_type: "bolt" } },
  { cls: "fastener", re: /\bnuts?\b/gi, set: { fastener_type: "nut" } },
  { cls: "fastener", re: /\bwashers?\b/gi, set: { fastener_type: "washer" } },
  { cls: "fastener", re: /\b(?:standoffs?|spacers?)\b/gi, set: { fastener_type: "standoff" } },
  { cls: "fastener", re: /\brivets?\b/gi, set: { fastener_type: "rivet" } },
  { cls: "fastener", re: /\b(?:threaded |heat-?set )?inserts?\b/gi, set: { fastener_type: "insert" } },
];

// A power "adapter" is mains power only when the name says so ("ESP-01 Adapter
// Board" and "SSD to USB Adapter" are not).
const POWERED = /\b(?:ac\/dc|power|wall|mains|plug|psu|supply|\d+(?:\.\d+)?\s?v\b)/i;
const NOT_LED = /\b(?:lamp|magnif\w*|bulb|holder|voltmeter|volt ?meter|meter)\b/i;

/** The class noun of a product's head (or of a BOM line's function). */
export function classOf(text: string, context = text): { cls: AttrClass; set: Record<string, unknown> } | null {
  let best: { cls: AttrClass; set: Record<string, unknown>; end: number; len: number } | null = null;
  for (const r of CLASS_RULES) {
    for (const m of text.matchAll(r.re)) {
      const end = (m.index ?? 0) + m[0].length;
      if (r.cls === "led" && NOT_LED.test(text)) continue;
      if (r.set?.power_type === "adapter" && /adapter/i.test(m[0]) && !/power|ac\/dc|wall/i.test(m[0]) && !POWERED.test(context)) continue;
      if (!best || end > best.end || (end === best.end && m[0].length > best.len))
        best = { cls: r.cls, set: r.set ?? {}, end, len: m[0].length };
    }
  }
  return best ? { cls: best.cls, set: best.set } : null;
}

// ---------------------------------------------------------------------------
// per-class fields, read from the whole name

type SensorKind = [RegExp, string | null, string | null];
// First hit wins: [pattern, measures, sensor_type].
const SENSOR_KINDS: SensorKind[] = [
  [/\bpir\b|passive infrared|hc-?sr501|\bam312\b|\bsr602\b/i, "motion", "pir"],
  [/mmwave|\bradar\b|rcwl|ld2410|human presence/i, "motion", "radar"],
  [/\buv\b|guva|ultraviolet/i, "other", "uv"],
  [/line track\w*|line follow\w*|reflectance|tcrt5000|\bqtr-|line sensor/i, "other", "ir_reflective"],
  [/obstacle/i, "distance", "ir_reflective"],
  [/ultrasonic|hc-?sr04|jsn-?sr04|a02yyuw/i, "distance", "ultrasonic"],
  [/\btof\b|time-of-flight|vl53\w*|lidar|tf-?luna|tfmini|laser distance/i, "distance", "tof"],
  [/\bldr\b|photoresistor|photocell|light dependent|phototransistor|photodiode|temt6000|als-pt19/i, "light", "photo"],
  [/bh1750|tsl25\d1|veml7700|\blux\b|light intensity|ambient light/i, "light", "ambient_light"],
  [/gp2y|distance sensor/i, "distance", null],
  [/colou?r (?:sensor|recognition)|tcs3200|tcs34725|as7262/i, "color", null],
  [/soil moisture/i, "soil_moisture", null],
  [/water level|liquid level|\bfloat\b/i, "water_level", null],
  [/\bflow\b/i, "flow", null],
  [/\bmq-?\d+|\bgas\b|\bco2\b|air quality|ozone|oxygen|tvoc|pm2\.5|alcohol/i, "gas", null],
  [/barometric|air pressure|\bbmp\d+|\bbme\d+/i, "pressure", null],
  [/\bsound\b|microphone|\bmic\b/i, "sound", null],
  [/current sensor|acs7\d\d|ina219|sct-?013|zmct\w*|current transformer/i, "current", null],
  [/voltage sensor|voltage detection|zmpt\w*|ac voltage/i, "voltage", null],
  [/accelerometer|\bgyro|mpu-?\d{4}|adxl\w*|\bimu\b|\bdof\b/i, "acceleration", null],
  [/\bgps\b|neo-?6m/i, "gps", null],
  [/\btouch\b|ttp223/i, "touch", null],
  [/humidity|\bdht\d*|\bsht\d+|\baht\d+/i, "humidity", "temp_humidity"],
  [/thermocouple|max6675/i, "temperature", "thermocouple"],
  [/thermistor|\bntc\b/i, "temperature", "thermistor"],
  [/temperature|ds18b20|\blm35|mlx90614/i, "temperature", null],
  [/\blight\b/i, "light", null],
  [/\btilt\b|vibration|\bshock\b/i, "other", "tilt"],
  [/\bhall\b|magnetic/i, "other", "hall"],
  [/\bflame\b/i, "other", "flame"],
];

function sensorFields(name: string, a: Attributes) {
  const kind = SENSOR_KINDS.find(([re]) => re.test(name));
  if (kind) {
    if (kind[1]) a.measures = kind[1];
    if (kind[2]) a.sensor_type = kind[2];
  }
  if (a.measures === "soil_moisture" && /capacitive/i.test(name)) a.sensor_type = "capacitive";
  if (a.measures === "soil_moisture" && /resistive/i.test(name)) a.sensor_type = "resistive";
  // Interface: a single stated one; "analog and digital" states neither alone.
  const both = /analog\s?(?:and|&|\/)\s?digital|digital\s?(?:and|&|\/)\s?analog/i.test(name);
  if (/\bi2c\b|\biic\b/i.test(name)) a.interface = "i2c";
  else if (/\bspi\b/i.test(name)) a.interface = "spi";
  else if (/\buart\b|\bserial\b|\brs485\b|\bttl\b/i.test(name)) a.interface = "uart";
  else if (/1-?wire|one-?wire/i.test(name)) a.interface = "onewire";
  else if (!both && /\banalog\b/i.test(name)) a.interface = "analog";
  else if (!both && /\bdigital\b/i.test(name)) a.interface = "digital";
  else if (!both && /^(?:photocell|ldr|photoresistor|thermistor)\b/i.test(headNoun(name))) a.interface = "analog";
  const range = voltRange(name);
  if (range) [a.supply_min_v, a.supply_max_v] = range;
}

const COLOURS: [RegExp, string][] = [
  [/\brgb\b|addressable|ws281\d|neopixel|sk6812/i, "rgb"],
  [/\bwhite\b/i, "white"],
  [/\bred\b/i, "red"],
  [/\bgreen\b/i, "green"],
  [/\bblue\b/i, "blue"],
  [/\byellow\b/i, "yellow"],
  [/\b(?:orange|infrared|ir|uv|pink|purple)\b/i, "other"],
];

function ledFields(name: string, a: Attributes) {
  const hits = COLOURS.filter(([re]) => re.test(name)).map(([, c]) => c);
  // "Red Yellow Blue Green" kits state no single colour.
  const distinct = [...new Set(hits)];
  if (distinct.includes("rgb")) a.color = "rgb";
  else if (distinct.length === 1) a.color = distinct[0];
  const size = name.match(/\b(\d+(?:\.\d+)?)\s?mm\b/i);
  const sizes = new Set([...name.matchAll(/\b(\d+(?:\.\d+)?)\s?mm\b/gi)].map((m) => m[1]));
  if (size && sizes.size === 1) {
    a.size_mm = num(size[1]);
    if ([3, 5, 8, 10].includes(a.size_mm as number) && !/\bsmd\b/i.test(name)) a.package = "through_hole";
  }
  if (/\bsmd\b|\b(?:5050|2835|3528)\b/i.test(name)) a.package = "smd";
}

const packageOf = (name: string) =>
  /through-?hole|\btht\b|\baxial\b|\bdip\b|\bto-?92\b|\bto-?220\b/i.test(name)
    ? "through_hole"
    : /\bsmd\b|\bsmt\b|\b0[46]0[358]\b|\b1206\b|\bsot-?23\b/i.test(name)
      ? "smd"
      : null;

function resistorFields(name: string, a: Attributes) {
  const r = parseOhms(name, true);
  if (r) a.resistance_ohm = r;
  const w = name.match(/\b1\/(\d)\s?w\b/i);
  if (w) a.power_w = 1 / Number(w[1]);
  else {
    const p = name.match(/\b(\d+(?:\.\d+)?)\s?w\b/i);
    if (p) a.power_w = num(p[1]);
  }
  const tol = name.match(/±\s?(\d+(?:\.\d+)?)\s?%/);
  if (tol) a.tolerance_pct = num(tol[1]);
  const pkg = packageOf(name);
  if (pkg) a.package = pkg;
}

function capacitorFields(name: string, a: Attributes) {
  const f = parseFarads(name);
  if (f) a.capacitance_f = f;
  const v = singleVolt(name);
  if (v) a.voltage_v = v;
  const d = name.match(/\b(ceramic|electrolytic|film|tantalum)\b/i);
  if (d) a.dielectric = d[1].toLowerCase();
  const pkg = packageOf(name);
  if (pkg === "through_hole" || pkg === "smd") a.package = pkg;
}

function diodeFields(name: string, a: Attributes) {
  if (/schottky|1n58\d\d/i.test(name)) a.diode_type = "schottky";
  else if (/zener/i.test(name)) a.diode_type = "zener";
  else if (/1n4148|signal/i.test(name)) a.diode_type = "signal";
  else if (/rectifier|1n400\d/i.test(name)) a.diode_type = "rectifier";
  const i = name.match(/\b(\d+(?:\.\d+)?)\s?a\b/i);
  if (i) a.current_a = num(i[1]);
  const v = singleVolt(name);
  if (v) a.voltage_v = v;
}

function transistorFields(name: string, a: Attributes) {
  if (/p-?channel|p-?mosfet/i.test(name)) a.transistor_type = "p_mosfet";
  else if (/n-?channel|n-?mosfet|mosfet|irlz44|irf5[24]0|2n7000/i.test(name)) a.transistor_type = "n_mosfet";
  else if (/\bpnp\b|2n2907|bc557|s8550/i.test(name)) a.transistor_type = "pnp";
  else if (/\bnpn\b|2n2222|bc547|tip12\d|s8050|darlington/i.test(name)) a.transistor_type = "npn";
  const pkg = name.match(/\b(to-?92|to-?220|sot-?23)\b/i);
  if (pkg) a.package = pkg[1].toLowerCase().replace("-", "");
}

function switchFields(name: string, a: Attributes) {
  if (/\blimit\b|micro ?switch|microswitch/i.test(name)) a.switch_type = "limit";
  else if (/\breed\b|magnetic (?:door )?switch|door magnetic/i.test(name)) a.switch_type = "reed";
  else if (/\btoggle\b/i.test(name)) a.switch_type = "toggle";
  else if (/\bslide\b/i.test(name)) a.switch_type = "slide";
  else if (/\brocker\b/i.test(name)) a.switch_type = "rocker";
  else if (/tactile|push ?button|momentary/i.test(name)) a.switch_type = "tactile";
}

function headerFields(name: string, a: Attributes) {
  if (/screw terminal|terminal block/i.test(name)) a.connector_type = "screw_terminal";
  else if (/\bjst/i.test(name)) a.connector_type = "jst";
  else if (/dupont/i.test(name)) a.connector_type = "dupont";
  else if (/female header/i.test(name)) a.connector_type = "female_header";
  else if (/header/i.test(name)) a.connector_type = "pin_header";
  const pins = name.match(/\b(\d+)[- ]?pins?\b/i);
  if (pins) a.pins = Number(pins[1]);
  const pitch = name.match(/\b(\d(?:\.\d+)?)\s?mm(?: pitch)?\b/i);
  if (pitch && /pitch/i.test(name)) a.pitch_mm = num(pitch[1]);
}

const PLATFORMS: [RegExp, string, number][] = [
  [/\besp32/i, "esp32", 3.3],
  [/\besp8266|nodemcu v\d/i, "esp8266", 3.3],
  [/\bpico\b/i, "raspberry_pi_pico", 3.3],
  [/\braspberry pi\b/i, "raspberry_pi", 3.3],
  [/\b(?:arduino )?uno\b/i, "arduino_uno", 5],
  [/\b(?:arduino )?nano\b/i, "arduino_nano", 5],
  [/\b(?:arduino )?mega\b/i, "arduino_mega", 5],
  [/\bstm32|blue ?pill/i, "stm32", 3.3],
];

function boardFields(name: string, a: Attributes) {
  const p = PLATFORMS.find(([re]) => re.test(name));
  if (p) [a.platform, a.logic_v] = [p[1], p[2]];
  const conn: string[] = [];
  if (/wi-?fi/i.test(name)) conn.push("wifi");
  if (/bluetooth|\bble\b/i.test(name)) conn.push("bluetooth");
  if (/\blora\b/i.test(name)) conn.push("lora");
  if (conn.length) a.connectivity = conn;
}

function moduleFields(name: string, a: Attributes) {
  const ch = name.match(/\b(\d+)\s?-?\s?(?:channel|ch)\b/i);
  if (ch) a.channels = Number(ch[1]);
  const i = name.match(/\((\d+(?:\.\d+)?)\s?a\)|\b(\d+(?:\.\d+)?)\s?a\b/i);
  if (i) a.current_a = num(i[1] ?? i[2]);
  if (/\bi2c\b|\biic\b/i.test(name)) a.interface = "i2c";
  else if (/\bspi\b/i.test(name)) a.interface = "spi";
}

function actuatorFields(name: string, a: Attributes) {
  const v = singleVolt(name);
  if (v) a.voltage_v = v;
  const t = name.match(/\b(\d+(?:\.\d+)?)\s?kg(?:[·.\s-]?cm)?\b/i);
  if (t && a.actuator_type === "servo") a.torque_kgcm = num(t[1]);
}

function powerFields(name: string, a: Attributes) {
  if (a.power_type !== "usb_cable") {
    const v = singleVolt(name);
    if (v) a.voltage_v = v;
  }
  const i = name.match(/\b(\d+(?:\.\d+)?)\s?a\b/i);
  if (i && a.power_type !== "usb_cable") a.current_a = num(i[1]);
  const mah = name.match(/\b(\d+)\s?mah\b/i);
  if (mah) a.capacity_mah = Number(mah[1]);
  const s = name.match(/\b(\d)s\b/i);
  if (s && a.power_type === "battery") a.cells = Number(s[1]);
}

function consumableFields(name: string, a: Attributes) {
  if (a.consumable_type === "breadboard") {
    const tp = name.match(/\b(\d+)\s?tie[- ]?points?\b/i);
    if (tp) a.size = tp[1];
  }
  if (a.consumable_type === "jumper_wires") {
    const kinds = [
      /male to male|m-m\b/i.test(name) && "M-M",
      /male to female|female to male|m-f\b/i.test(name) && "M-F",
      /female to female|f-f\b/i.test(name) && "F-F",
    ].filter(Boolean) as string[];
    if (kinds.length) a.size = kinds.join("/");
  }
}

function fastenerFields(name: string, a: Attributes) {
  const threads = new Set([...name.matchAll(/\bM(\d(?:\.5)?)\b/g)].map((m) => `M${m[1]}`));
  if (threads.size === 1) a.thread = [...threads][0];
  const len = name.match(/\bM\d(?:\.5)?\s?[x×]\s?(\d+)\s?(?:mm)?\b/i);
  if (len) a.length_mm = Number(len[1]);
  const mat = name.match(/\b(stainless(?: steel)?|brass|nylon|steel|aluminium|aluminum)\b/i);
  if (mat) a.material = mat[1].toLowerCase().replace(/ steel$/, "");
}

const FIELDS: Partial<Record<AttrClass, (name: string, a: Attributes) => void>> = {
  sensor: sensorFields,
  led: ledFields,
  resistor: resistorFields,
  capacitor: capacitorFields,
  diode: diodeFields,
  transistor: transistorFields,
  switch: switchFields,
  header: headerFields,
  board: boardFields,
  module: moduleFields,
  actuator: actuatorFields,
  power: powerFields,
  consumable: consumableFields,
  fastener: fastenerFields,
};

/** Class + attributes from a product's name; `{}` when its head names no class. */
export function deriveAttributes(p: NamedProduct): Derived {
  const name = (p.name ?? "").normalize("NFKC");
  const head = headNoun(name);
  const c = classOf(head);
  const packSize = parsePack(name);
  if (!c) return { attributes: {}, packSize };
  const a: Attributes = { class: c.cls, ...c.set };
  FIELDS[c.cls]?.(name, a);
  return { attributes: a, packSize };
}

/**
 * The attributes the matcher uses for a product: the owner's own (they always
 * win) completed by the parse when both name the same class; the parse alone
 * when the owner set no class. `derived` says the class came from the name.
 */
export function effectiveAttributes(p: NamedProduct & { attributes?: unknown }): { attributes: Attributes; derived: boolean } {
  const own = (p.attributes ?? {}) as Attributes;
  const parsed = deriveAttributes(p).attributes;
  if (isAttrClass(own.class)) {
    if (parsed.class !== own.class) return { attributes: own, derived: false };
    const merged: Attributes = { ...parsed };
    for (const [k, v] of Object.entries(own)) if (v !== null && v !== undefined && v !== "") merged[k] = v;
    return { attributes: merged, derived: false };
  }
  return { attributes: parsed, derived: isAttrClass(parsed.class) };
}

// ---------------------------------------------------------------------------
// BOM lines

// What a line's own words may add: only what decides the TYPE of part (and a
// resistor's value). Supply voltages, packages and ratings come from the line's
// own attributes only, never from its wording.
const LINE_KEYS: Partial<Record<AttrClass, string[]>> = {
  sensor: ["measures", "sensor_type", "interface"],
  module: ["module_type", "channels"],
  board: ["platform"],
  actuator: ["actuator_type"],
  led: ["color", "size_mm"],
  resistor: ["resistance_ohm"],
  capacitor: ["capacitance_f", "dielectric"],
  diode: ["diode_type"],
  transistor: ["transistor_type"],
  switch: ["switch_type"],
  header: ["connector_type"],
  power: ["power_type"],
  consumable: ["consumable_type"],
  fastener: ["fastener_type", "thread"],
};

/**
 * The fields that decide what a part IS. When a line asks for one, a product
 * must state the same value: a product that does not say is not a candidate
 * (a PIR line never gets a sensor of unknown kind).
 */
export const CORE_KEYS: Partial<Record<AttrClass, string[]>> = {
  sensor: ["measures", "sensor_type"],
  module: ["module_type"],
  board: ["platform"],
  actuator: ["actuator_type"],
  power: ["power_type"],
  consumable: ["consumable_type"],
  fastener: ["fastener_type"],
  switch: ["switch_type"],
};

export type LineLike = { function: string; spec: string; class?: string; attributes?: Record<string, unknown> };

/**
 * What a BOM line asks for: its own attributes, completed by what its function
 * and spec say ("motion sensor" + "PIR, digital output" → measures motion,
 * sensor_type pir, interface digital). A line with no class gets one from its
 * function when the words name one. A resistor's value is moved to the nearest
 * standard E12 value. `{}` when nothing is known.
 */
export function lineAttributes(line: LineLike): Attributes {
  const own = (line.attributes ?? {}) as Attributes;
  const fn = (line.function ?? "").normalize("NFKC");
  const text = `${fn} ${line.spec ?? ""}`.normalize("NFKC");
  // The function names the part (a bare platform name, "ESP32", is a board).
  const c = classOf(fn, text) ?? (PLATFORMS.some(([re]) => re.test(fn)) ? { cls: "board" as const, set: {} } : null);
  const cls = isAttrClass(line.class) ? line.class : isAttrClass(own.class) ? own.class : c?.cls;
  if (!isAttrClass(cls)) return {};
  const parsed: Attributes = { class: cls, ...(c?.cls === cls ? c.set : {}) };
  FIELDS[cls]?.(text, parsed);
  const out: Attributes = { class: cls };
  for (const k of LINE_KEYS[cls] ?? []) if (parsed[k] !== undefined) out[k] = parsed[k];
  for (const [k, v] of Object.entries(own)) if (k !== "class" && v !== null && v !== undefined && v !== "") out[k] = v;
  if (cls === "resistor" && Number(out.resistance_ohm) > 0) out.resistance_ohm = nearestE12(Number(out.resistance_ohm));
  return out;
}
