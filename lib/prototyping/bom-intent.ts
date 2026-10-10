// What a BOM line is ASKING FOR, checked against what an untyped product IS.
//
// The text matcher (bom-match.ts) finds products that share words with a line.
// Words are not enough: "ESP32" is also in "ESP32 I/O Expansion Shield",
// "USB" is also in "USB Type-B Female Connector", "M3" is also in "M3 Brass
// Spacer Kit", and "module" is also in a motor-driver's category. This file is
// the deterministic guard that stops accessories from winning over the device:
//
//  1. ACCESSORY words in the product's head (its name before the first dash or
//     comma) exclude it, unless the line itself asks for that word. Kit words
//     do not exclude, they make the product doubtful.
//  2. The line's core noun (board, relay module, adapter, USB cable, screw) must
//     match the product's name, not only its category.
//  3. Fasteners need the fastener type (a screw is not a spacer or a standoff)
//     and the stated M-size.
//  4. Products of the line's own storefront class rank first.
//
// A DOUBTFUL candidate stays visible but is never picked automatically
// (LineMatch.auto): the client chooses. Pure; no I/O.

import type { BomLine } from "./analysis";
import type { Candidate } from "./bom";

export type Guard = {
  /** false = the product is not a candidate for this line at all. */
  ok: boolean;
  /** true = shown as an option, never picked automatically. */
  doubt: boolean;
  /** Added to the text score: the product's storefront class equals the line's. */
  bonus: number;
  why: string[];
};

const OUT: Guard = { ok: false, doubt: false, bonus: 0, why: [] };

// Words that make a product an accessory of the device the line asks for.
const HARD_ACCESSORY =
  /\b(shield|expansion|socket|jack|barrel|spacer|standoff|holder|case|enclosure|connector|breakout|programmer|terminal|adapter|adaptor|converter|extension|splitter|clip|dip|bracket|cover|dongle|hub|charger|charging|protection|management|bms|gauge|ups|hat)s?\b/gi;
// A kit or assortment can contain the thing, but is a different purchase.
const SOFT_ACCESSORY = /\b(kit|assortment|set|combo)s?\b/i;
// "Hex Socket Screw" and "socket head" describe a screw, not a socket.
const NOT_ACCESSORY_PHRASE = /\b(?:hex|allen)\s+socket\b|\bsocket\s+(?:head|cap)\b/gi;

/** The name before its first " – ", " - ", comma or bracket. */
export function headOf(name: string): string {
  return name.split(/\s[–—-]\s|,\s|\(/)[0].trim();
}

const stem = (w: string) => w.toLowerCase().replace(/s$/, "");

const attrOf = (line: BomLine, key: string): string => {
  const v = (line.attributes as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
};

/** Everything the line says, lower-case: function, spec and string attributes. */
function lineText(line: BomLine): string {
  const a = Object.values(line.attributes ?? {}).filter((v) => typeof v === "string" || typeof v === "number");
  return `${line.function} ${line.spec} ${a.join(" ")}`.toLowerCase();
}

// ---- platforms, module types: the attribute (or the function) picks the words

const PLATFORM_NAME: Record<string, RegExp> = {
  esp32: /esp32/i,
  esp8266: /esp8266/i,
  arduino_uno: /\buno\b/i,
  arduino_nano: /\bnano\b/i,
  arduino_mega: /\bmega\b/i,
  raspberry_pi: /raspberry/i,
  raspberry_pi_pico: /\bpico\b/i,
  stm32: /stm32/i,
};
const PLATFORM_IN_TEXT: [string, RegExp][] = [
  ["esp32", /\besp32\b/],
  ["esp8266", /\besp8266\b/],
  ["raspberry_pi_pico", /\b(?:raspberry pi )?pico\b/],
  ["raspberry_pi", /\braspberry\b/],
  ["arduino_uno", /\barduino uno\b/],
  ["arduino_nano", /\barduino nano\b/],
  ["arduino_mega", /\barduino mega\b/],
  ["stm32", /\bstm32\b/],
];
// ESP32-S3, -C6, -CAM are other chips; a plain "ESP32" line prefers the plain one.
const ESP32_VARIANT = /\besp32[-\s]?(?:s2|s3|c3|c6|h2|p4|cam)\b/i;
const BOARDNESS = /\b(board|devkit|dev kit|development|nodemcu|nucleo|launchpad)\b/i;

const MODULE_NAME: Record<string, RegExp> = {
  relay: /\brelay/i,
  motor_driver: /\b(motor driver|h-?bridge|l298|l293|drv\d+|a4988|tb6612)/i,
  display: /\b(display|lcd|oled|tft)\b/i,
  charger: /\b(charger|charging|tp4056)\b/i,
  regulator: /\b(regulator|buck|boost|lm2596|ams1117)\b/i,
  rtc: /\b(rtc|ds3231|ds1307|real time clock)\b/i,
  amplifier: /\b(amplifier|pam8403|lm386)\b/i,
  level_shifter: /\b(level (?:shifter|converter|translator)|logic level)\b/i,
};
const MODULE_IN_TEXT: [string, RegExp][] = [
  ["relay", /\brelay\b/],
  ["motor_driver", /\b(motor driver|h-?bridge)\b/],
  ["display", /\b(display|lcd|oled)\b/],
  ["level_shifter", /\b(level (?:shifter|converter|translator)|logic level)\b/],
];

const FASTENER_NAME: Record<string, RegExp> = {
  screw: /(?<!\b(?:lead|set|thumb)\s)\bscrews?\b(?!\s*(?:driver|terminal|less|shield))/i,
  bolt: /\bbolts?\b/i,
  nut: /\bnuts?\b/i,
  washer: /\bwashers?\b/i,
  standoff: /\b(standoffs?|spacers?)\b/i,
  rivet: /\brivets?\b/i,
  insert: /\binserts?\b/i,
};
const FASTENER_IN_TEXT: [string, RegExp][] = [
  ["screw", /\bscrews?\b/],
  ["bolt", /\bbolts?\b/],
  ["nut", /\bnuts?\b/],
  ["washer", /\bwashers?\b/],
  ["standoff", /\b(standoffs?|spacers?)\b/],
  ["rivet", /\brivets?\b/],
];

const METRIC = /\bm(\d{1,2}(?:\.5)?)\b/gi;
const VOLT = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s?v(?:olt|dc|ac)?\b/gi;
const setOf = (re: RegExp, s: string) => new Set([...s.matchAll(re)].map((m) => m[1]));

const POWER_WORD = /\b(power|supply|psu|ac\/dc|charger|wall|official)\b/i;
const ADAPTER_NAME = /\b(adapter|adaptor|power supply|psu)\b/i;
const NOT_A_POWER_ADAPTER = /serial|uart|ttl|rs\d+|hdmi|ssd|nvme|sim\b|otg|dip/i;
const USB_CONNECTOR = /\b(micro|mini|type-?[abc]|usb-?c|lightning)\b/;

/** Storefront class (parts.store_category, else category) per line class. */
function classStore(line: BomLine): RegExp | null {
  switch (line.class) {
    case "board":
      return /board|microcontroller/i;
    case "module":
      return /module/i;
    case "power":
      return attrOf(line, "power_type") === "usb_cable" ? /cable|connector/i : /power/i;
    case "header":
      return /cable|connector/i;
    case "consumable":
      return attrOf(line, "consumable_type") === "usb_cable" ? /cable|connector/i : null;
    case "fastener":
      return /fastener/i;
    case "sensor":
      return /sensor/i;
    case "actuator":
      return /motor|mechanical/i;
    default:
      return null;
  }
}

/** True when the line itself asks for this accessory word (so it is no accessory). */
function lineAllows(line: BomLine, word: string, text: string, intentAllows: RegExp | null): boolean {
  const w = stem(word);
  if (new RegExp(`\\b${w}`, "i").test(text)) return true;
  if (intentAllows?.test(word)) return true;
  if (line.class === "header" && /^(connector|terminal|socket|jack|dip|breakout|extension|splitter)s?$/i.test(word)) return true;
  if (attrOf(line, "power_type") === "battery_holder" && /^(holder|clip|connector|case)s?$/i.test(word)) return true;
  if (/^(spacer|standoff)s?$/i.test(word) && /spacer|standoff/.test(text)) return true;
  return false;
}

type Intent = {
  text: string;
  fn: string;
  platform: string;
  moduleType: string;
  fastenerType: string;
  thread: string;
  wantsUsbCable: boolean;
  wantsPowerAdapter: boolean;
  wantsBattery: boolean;
  /** Accessory words the intent itself makes legitimate. */
  allows: RegExp | null;
};

/** What the line is asking for, from its attributes first, then its function. */
function intentOf(line: BomLine): Intent {
  const text = lineText(line);
  const fn = line.function.toLowerCase();
  const platform = attrOf(line, "platform") || PLATFORM_IN_TEXT.find(([, re]) => re.test(fn))?.[0] || "";
  const moduleType = attrOf(line, "module_type") || MODULE_IN_TEXT.find(([, re]) => re.test(fn))?.[0] || "";
  const fastenerType =
    attrOf(line, "fastener_type") ||
    (line.class === "fastener" || /\bm\d/.test(fn) ? FASTENER_IN_TEXT.find(([, re]) => re.test(fn))?.[0] : "") ||
    "";
  const thread = (attrOf(line, "thread") || (text.match(/\bm(\d{1,2}(?:\.5)?)\b/)?.[1] ?? "")).replace(/^m/i, "");
  const wantsUsbCable =
    attrOf(line, "power_type") === "usb_cable" ||
    attrOf(line, "consumable_type") === "usb_cable" ||
    (/\busb\b/.test(fn) && /\bcable\b/.test(fn));
  const wantsPowerAdapter =
    !wantsUsbCable &&
    (attrOf(line, "power_type") === "adapter" ||
      ((line.class === "power" || !line.class) &&
        /\b(adapter|adaptor|power supply|psu)\b/.test(fn) &&
        /\b(usb|plug-?in|wall|mains|power|ac|dc|\d+v)\b/.test(text) &&
        !NOT_A_POWER_ADAPTER.test(fn)));
  const wantsBattery =
    !wantsUsbCable &&
    !wantsPowerAdapter &&
    (attrOf(line, "power_type") === "battery" ||
      ((line.class === "power" || !line.class) &&
        /\bbatter(y|ies)\b/.test(fn) &&
        !/\b(holder|charger|clip|case|box|adapter)\b/.test(fn)));
  return {
    text,
    fn,
    platform,
    moduleType,
    fastenerType,
    thread,
    wantsUsbCable,
    wantsPowerAdapter,
    wantsBattery,
    // A level shifter is sold as a "logic level converter".
    allows: wantsPowerAdapter
      ? /^(adapter|adaptor|charger)s?$/i
      : moduleType === "level_shifter"
        ? /^(converter|translator)s?$/i
        : null,
  };
}

/**
 * Accessories only (step 1). Used for products that carry attributes too: a
 * board whose name says "Expansion Shield" is not the board the line asks for,
 * whatever its class says.
 */
export function guardAccessory(line: BomLine, p: Candidate): Guard {
  const it = intentOf(line);
  const head = headOf(p.name ?? "").replace(NOT_ACCESSORY_PHRASE, " ");
  for (const m of head.matchAll(HARD_ACCESSORY)) {
    if (!lineAllows(line, m[1], it.text, it.allows)) return { ...OUT, why: [`accessory: ${m[1].toLowerCase()}`] };
  }
  if (SOFT_ACCESSORY.test(head) && !SOFT_ACCESSORY.test(it.text))
    return { ok: true, doubt: true, bonus: 0, why: ["a kit, not the single item"] };
  return { ok: true, doubt: false, bonus: 0, why: [] };
}

/**
 * Decide whether an UNTYPED product (text-only match) can stand for the line.
 * `ok: false` removes it; `doubt` keeps it as an option that is never auto-picked.
 */
export function guardText(line: BomLine, p: Candidate): Guard {
  const name = p.name ?? "";
  const head = headOf(name);
  const it = intentOf(line);
  const { fn, text, platform, moduleType, fastenerType, thread } = it;

  // ---- 1. accessories ------------------------------------------------------
  const acc = guardAccessory(line, p);
  if (!acc.ok) return acc;
  let doubt = acc.doubt;
  const why = [...acc.why];
  let bonus = 0;

  // ---- 2. the core noun must be in the NAME --------------------------------
  if (platform && PLATFORM_NAME[platform]) {
    if (!PLATFORM_NAME[platform].test(name)) return OUT;
    if (BOARDNESS.test(head)) bonus += 2;
    if (platform === "esp32" && !ESP32_VARIANT.test(fn) && !ESP32_VARIANT.test(name)) bonus += 1;
  }

  if (moduleType && MODULE_NAME[moduleType]) {
    if (!MODULE_NAME[moduleType].test(name)) return OUT;
    // "relay module" asks for the module, not the bare relay component.
    if (/\bmodule\b/.test(fn) && !/\bmodules?\b/i.test(head)) return OUT;
  }

  if (it.wantsUsbCable) {
    if (!/\bcable\b/i.test(name) || !/\busb\b/i.test(name)) return OUT;
    // Micro, Mini, Type-B, Type-C: with no connector named, the client chooses.
    if (!USB_CONNECTOR.test(text)) {
      doubt = true;
      why.push("connector type not stated");
    }
  }

  if (it.wantsPowerAdapter) {
    if (!ADAPTER_NAME.test(name) || !POWER_WORD.test(name)) return OUT;
    if (NOT_A_POWER_ADAPTER.test(head)) return OUT;
    const wantV = Number(attrOf(line, "voltage_v"));
    const have = setOf(VOLT, name.toLowerCase());
    if (Number.isFinite(wantV) && wantV > 0 && have.size > 0 && !have.has(String(wantV))) return OUT;
  }

  // A battery line wants a cell or pack, not its charger, protection board or holder.
  if (it.wantsBattery && !/\b(batter(y|ies)|lipo|li-?ion|18650|cell)\b/i.test(name)) return OUT;

  // ---- 3. fasteners: the type and the size ---------------------------------
  if (fastenerType && FASTENER_NAME[fastenerType]) {
    if (!FASTENER_NAME[fastenerType].test(head)) return { ...OUT, why: [`not a ${fastenerType}`] };
    if (thread) {
      const sizes = setOf(METRIC, name.toLowerCase());
      if (!sizes.has(thread)) return { ...OUT, why: [`no M${thread} in the name`] };
    }
  }

  // ---- 4. the product's own storefront class equals the line's -------------
  const store = classStore(line);
  const prodStore = (p as { store_category?: string | null }).store_category ?? p.category ?? "";
  if (store?.test(prodStore)) bonus += 3;

  return { ok: true, doubt, bonus, why };
}
