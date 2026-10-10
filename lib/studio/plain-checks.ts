// Plain-language checks for the Design Studio (EN + AR, product copy).
//
// One sentence per finding for a non-engineer: no jargon, no part ids, ≤ 90
// characters. We run the EXISTING rule engine (hardRules / sanityChecks /
// powerBudget from lib/prototyping/netlist.ts) on the legacy form of the
// circuit, plus Studio checks read straight from the nets (voltages, logic
// levels, pins that could not be connected, power source vs the idea).
//   ok:false = something we fixed for them, or something that needs attention;
//   ok:true  = at most 3 reassurances, most relevant first.
//
// Pure. Strings live here keyed by locale (no next-intl), like library names.

import { hardRules, powerBudget, sanityChecks, type Netlist as LegacyNetlist } from "@/lib/prototyping/netlist";
import type { LibraryPart, Net, Pin, ProductSpec, StudioCheck, StudioComponent } from "./schema";
import {
  DEV_TO_MCU,
  MCU_TO_DEV,
  RAIL_RANGE,
  chargerPins,
  isBattery,
  isCharger,
  isConverter,
  isDriver,
  isInductive,
  isMcu,
  isPowerRole,
  isPowerSource,
  isSeriesHelper,
  isShifter,
  isSignalRole,
  splitRef,
  symbolKind,
  type GetPart,
  type Locale,
} from "./netlist";

export const CHECK_KEYS = [
  // Fixed for you
  "added_resistor",
  "added_shifter",
  "added_driver",
  "added_helper",
  // Needs attention
  "led_no_resistor",
  "inductive_on_gpio",
  "shorted_supplies",
  "power_budget",
  "unpowered",
  "voltage",
  "logic_up",
  "logic_down",
  "pins_out",
  "no_mcu",
  "supply_range",
  "no_battery",
  "battery_unwanted",
  "no_charger",
  // Reassurances
  "ok_battery",
  "ok_battery_usb",
  "ok_usb",
  "ok_mains",
  "ok_voltage",
  "ok_budget",
  "ok_pins",
  "ok_ground",
] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

/**
 * The copy. `{name}` is the part's plain name. Each line ≤ 90 characters
 * once filled; when a long name would break that, `{name}` becomes "this part".
 */
export const CHECK_TEXT: Record<CheckKey, Record<Locale, string>> = {
  added_resistor: {
    en: "We added a small resistor so the light can't burn out.",
    ar: "أضفنا مقاومة صغيرة حتى لا يحترق الضوء.",
  },
  added_shifter: {
    en: "We added a small adapter so your parts can't damage the board.",
    ar: "أضفنا محوّلًا صغيرًا حتى لا تُتلف قطعك اللوحة.",
  },
  added_driver: {
    en: "We added a driver board so the motor can't damage the main board.",
    ar: "أضفنا لوحة تشغيل حتى لا يُتلف المحرّك اللوحة الرئيسية.",
  },
  added_helper: {
    en: "We added {name} because another part needs it.",
    ar: "أضفنا {name} لأن قطعة أخرى تحتاجها.",
  },
  led_no_resistor: {
    en: "{name} needs a small resistor before it is safe to use.",
    ar: "يحتاج {name} إلى مقاومة صغيرة قبل استخدامه بأمان.",
  },
  inductive_on_gpio: {
    en: "{name} needs a driver board so it can't damage the main board.",
    ar: "يحتاج {name} إلى لوحة تشغيل حتى لا يُتلف اللوحة الرئيسية.",
  },
  shorted_supplies: {
    en: "Two power sources are joined together; they must be kept apart.",
    ar: "مصدرا طاقة متصلان معًا، ويجب فصلهما.",
  },
  power_budget: {
    en: "The parts need more power than the board can safely give.",
    ar: "تحتاج القطع إلى طاقة أكثر مما تعطيه اللوحة بأمان.",
  },
  unpowered: {
    en: "{name} isn't getting power yet.",
    ar: "لا تصل الطاقة إلى {name} بعد.",
  },
  voltage: {
    en: "{name} needs a voltage the board can't give.",
    ar: "يحتاج {name} إلى جهد كهربائي لا توفّره اللوحة.",
  },
  logic_up: {
    en: "{name} sends signals too strong for the board; it needs an adapter.",
    ar: "يرسل {name} إشارات أقوى مما تتحمّله اللوحة، ويحتاج إلى محوّل.",
  },
  logic_down: {
    en: "The board's signals are too strong for {name}; it needs an adapter.",
    ar: "إشارات اللوحة أقوى مما يتحمّله {name}، ويحتاج إلى محوّل.",
  },
  pins_out: {
    en: "The board ran out of free connections for {name}.",
    ar: "لم تعد في اللوحة توصيلات متاحة لـ{name}.",
  },
  no_mcu: {
    en: "Add a main board so the parts have something to talk to.",
    ar: "أضف لوحة تحكّم رئيسية لتتواصل معها القطع.",
  },
  supply_range: {
    en: "The battery can't run the board directly; it needs a different supply.",
    ar: "لا تستطيع البطارية تشغيل اللوحة مباشرة، وتحتاج إلى مصدر طاقة آخر.",
  },
  no_battery: {
    en: "Your idea runs on a battery, but no battery has been chosen yet.",
    ar: "فكرتك تعمل بالبطارية، لكن لم يتم اختيار بطارية بعد.",
  },
  battery_unwanted: {
    en: "A battery was chosen, but your idea is meant to run from a cable.",
    ar: "تم اختيار بطارية، لكن فكرتك مصمّمة لتعمل عبر سلك.",
  },
  no_charger: {
    en: "Add a charger so the battery can be refilled safely.",
    ar: "أضف شاحنًا لتُعاد تعبئة البطارية بأمان.",
  },
  ok_battery: {
    en: "Everything runs safely from the battery.",
    ar: "كل شيء يعمل بأمان من البطارية.",
  },
  ok_battery_usb: {
    en: "Everything runs from the battery, and it charges over USB.",
    ar: "كل شيء يعمل من البطارية، وتُشحن عبر USB.",
  },
  ok_usb: {
    en: "Everything runs safely from the USB cable.",
    ar: "كل شيء يعمل بأمان عبر سلك USB.",
  },
  ok_mains: {
    en: "Everything runs safely from the wall adapter.",
    ar: "كل شيء يعمل بأمان من محوّل الكهرباء.",
  },
  ok_voltage: {
    en: "Every part gets the right voltage from the board.",
    ar: "كل قطعة تحصل على الجهد المناسب من اللوحة.",
  },
  ok_budget: {
    en: "The board has plenty of power for all the parts.",
    ar: "لدى اللوحة طاقة كافية لكل القطع.",
  },
  ok_pins: {
    en: "Every part has its own connection on the board.",
    ar: "لكل قطعة توصيلها الخاص على اللوحة.",
  },
  ok_ground: {
    en: "All parts share one common ground wire.",
    ar: "تشترك كل القطع في سلك أرضي واحد.",
  },
};

const THIS_PART: Record<Locale, string> = { en: "this part", ar: "هذه القطعة" };
export const MAX_CHECK_CHARS = 90;

/** A part's plain name without the bracketed detail ("Small screen (0.96 inch)" → "Small screen"). */
export function plainName(p: LibraryPart, locale: Locale): string {
  const n = p.name[locale].replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return n || p.name[locale];
}

/** Fill a check sentence; falls back to "this part" when a long name breaks the length cap. */
export function checkText(key: CheckKey, locale: Locale, name?: string): string {
  const tpl = CHECK_TEXT[key][locale];
  const filled = tpl.replace("{name}", name ?? THIS_PART[locale]);
  if (filled.length <= MAX_CHECK_CHARS || !name) return capFirst(filled, locale);
  return capFirst(tpl.replace("{name}", THIS_PART[locale]), locale);
}
const capFirst = (s: string, locale: Locale) => (locale === "en" ? s.charAt(0).toUpperCase() + s.slice(1) : s);

type Entry = { c: StudioComponent; p: LibraryPart };

/** The voltage a net carries (nominal, max), from what drives it. */
function netVoltage(net: Net, byInst: Map<string, Entry>): { nominal: number; max: number } | null {
  let batteryRange: { nominal: number; max: number } | null = null;
  for (const e of byInst.values()) {
    if (isBattery(e.p)) {
      const plus = e.p.pins.find((x) => x.role !== "gnd");
      batteryRange = { nominal: plus?.voltage ?? (e.p.power.vMin + e.p.power.vMax) / 2, max: e.p.power.vMax };
    }
  }
  for (const r of net.pins) {
    const [inst, pinId] = splitRef(r);
    const e = byInst.get(inst);
    const pin = e?.p.pins.find((x) => x.id === pinId);
    if (!e || !pin) continue;
    if (isBattery(e.p) && pin.role !== "gnd") return batteryRange;
    if (isCharger(e.p) && chargerPins(e.p).out?.id === pin.id) return batteryRange ?? { nominal: pin.voltage ?? 3.7, max: 4.2 };
    if (isConverter(e.p) && (pin.role === "5v" || pin.role === "3v3")) {
      const v = pin.voltage ?? (pin.role === "5v" ? 5 : 3.3);
      return { nominal: v, max: v };
    }
  }
  for (const r of net.pins) {
    const [inst, pinId] = splitRef(r);
    const e = byInst.get(inst);
    const pin = e?.p.pins.find((x) => x.id === pinId);
    if (!e || !pin || !isMcu(e.p)) continue;
    if (pin.role === "3v3") return { nominal: pin.voltage ?? 3.3, max: pin.voltage ?? 3.3 };
    if (pin.role === "5v" || pin.role === "vin") return { nominal: pin.voltage ?? 5, max: pin.voltage ?? 5 };
  }
  return null;
}

/**
 * Every check for the circuit, in plain words. Fixes and problems first
 * (ok:false), then up to three reassurances (ok:true).
 */
export function studioChecks(
  components: StudioComponent[],
  nets: Net[],
  legacy: LegacyNetlist,
  spec: ProductSpec,
  getPart: GetPart,
  locale: Locale,
): StudioCheck[] {
  const entries: Entry[] = components.flatMap((c) => {
    const p = getPart(c.partId);
    return p ? [{ c, p }] : [];
  });
  const byInst = new Map(entries.map((e) => [e.c.instanceId, e]));
  const netOf = new Map<string, Net>();
  for (const n of nets) for (const r of n.pins) netOf.set(r, n);
  const nameOf = (inst: string) => {
    const e = byInst.get(inst);
    return e ? plainName(e.p, locale) : undefined;
  };

  const issues: StudioCheck[] = [];
  const seen = new Set<string>();
  const push = (key: CheckKey, inst?: string) => {
    const id = inst ? `${key}:${inst}` : key;
    const plain = checkText(key, locale, inst ? nameOf(inst) : undefined);
    if (seen.has(id) || issues.some((x) => x.plain === plain)) return;
    seen.add(id);
    issues.push({ id, ok: false, plain });
  };

  // 1. What we added for them.
  for (const e of entries.filter((x) => x.c.auto)) {
    if (symbolKind(e.p) === "resistor") push("added_resistor");
    else if (isShifter(e.p)) push("added_shifter");
    else if (isDriver(e.p)) push("added_driver");
    else push("added_helper", e.c.instanceId);
  }

  // 2. The existing rule engine on the legacy circuit.
  const hard = hardRules(legacy);
  for (const f of hard) {
    if (f.code === "led_no_resistor") push("led_no_resistor", f.ref);
    else if (f.code === "inductive_on_gpio") push("inductive_on_gpio", f.ref);
    else if (f.code === "shorted_supplies") push("shorted_supplies");
    else if (f.code === "power_budget") push("power_budget");
  }

  // A motor / pump / coil with no driver board to switch it.
  const drivers = entries.filter((e) => isDriver(e.p)).length;
  entries.filter((e) => isInductive(e.p)).forEach((e, i) => {
    if (i >= drivers) push("inductive_on_gpio", e.c.instanceId);
  });

  // 3. Studio checks from the nets.
  const mcu = entries.find((e) => isMcu(e.p));
  const mcuLogic = mcu?.p.power.logicV ?? 3.3;
  const voltageIssue = new Set<string>();
  const effLogic = (e: Entry): number => {
    const pp = e.p.pins.find((x) => isPowerRole(x.role) && netOf.has(`${e.c.instanceId}.${x.id}`));
    if (!pp) return mcuLogic;
    const v = netVoltage(netOf.get(`${e.c.instanceId}.${pp.id}`)!, byInst);
    if (!v) return e.p.power.logicV;
    return v.nominal >= 4.5 ? e.p.power.logicV : Math.min(e.p.power.logicV, 3.3);
  };
  if (!mcu && entries.length) push("no_mcu");
  for (const e of entries) {
    if (isMcu(e.p) || isPowerSource(e.p)) continue;
    const inst = e.c.instanceId;
    const ref = (pin: Pin) => `${inst}.${pin.id}`;
    // Supply pins: connected to a voltage the part takes?
    for (const pin of e.p.pins.filter((x) => isPowerRole(x.role))) {
      const net = netOf.get(ref(pin));
      if (!net) {
        if (mcu) {
          push("voltage", inst);
          voltageIssue.add(inst);
        }
        continue;
      }
      const v = netVoltage(net, byInst);
      if (v && (v.nominal < e.p.power.vMin - 1e-6 || v.nominal > e.p.power.vMax + 1e-6)) {
        push("voltage", inst);
        voltageIssue.add(inst);
      }
    }
    // Signal pins: connected at all, and at a level both sides can take?
    if (isShifter(e.p) || isSeriesHelper(e.p)) continue;
    for (const pin of e.p.pins.filter((x) => isSignalRole(x.role))) {
      const net = netOf.get(ref(pin));
      if (!net) {
        if (mcu && !symbolKind(e.p)) push("pins_out", inst);
        continue;
      }
      if (!mcu || pin.role === "adc") continue;
      const touchesMcu = net.pins.some((r) => splitRef(r)[0] === mcu.c.instanceId);
      if (!touchesMcu) continue;
      const eff = effLogic(e);
      if (mcuLogic < 4 && eff >= 4.5 && DEV_TO_MCU.has(pin.role)) push("logic_up", inst);
      if (mcuLogic >= 4.5 && eff < 4 && e.p.power.vMax < 4.5 && MCU_TO_DEV.has(pin.role)) push("logic_down", inst);
    }
  }

  // The legacy sanity check for anything still without power (not already explained).
  for (const f of sanityChecks(legacy)) {
    if (f.code !== "unpowered" || voltageIssue.has(f.ref)) continue;
    const e = byInst.get(f.ref);
    if (!e || isPowerSource(e.p) || isMcu(e.p)) continue;
    push("unpowered", f.ref);
  }

  // Power source vs the idea.
  const battery = entries.find((e) => isBattery(e.p));
  const charger = entries.find((e) => isCharger(e.p));
  const wantsBattery = spec.power === "battery" || spec.power === "battery_usb";
  if (wantsBattery && !battery) push("no_battery");
  if (!wantsBattery && battery) push("battery_unwanted");
  if (battery && !charger) push("no_charger");
  if (mcu && battery) {
    // The board pin fed by the battery chain: does its range take the battery?
    for (const pin of mcu.p.pins) {
      if (pin.role !== "vin" && pin.role !== "5v" && pin.role !== "3v3") continue;
      const net = netOf.get(`${mcu.c.instanceId}.${pin.id}`);
      if (!net) continue;
      const fedBySupply = net.pins.some((r) => {
        const e = byInst.get(splitRef(r)[0]);
        return !!e && isPowerSource(e.p);
      });
      if (!fedBySupply) continue;
      const v = netVoltage(net, byInst);
      const [lo, hi] = RAIL_RANGE[pin.role](mcu.p);
      if (v && (v.nominal < lo || v.nominal > hi || v.max > hi)) push("supply_range");
    }
  }

  // 4. Reassurances: the most relevant three that hold.
  const has = (...keys: CheckKey[]) => issues.some((x) => keys.includes(x.id.split(":")[0] as CheckKey));
  const ok: CheckKey[] = [];
  if (mcu && !has("no_battery", "battery_unwanted", "no_charger", "supply_range", "shorted_supplies", "power_budget")) {
    if (spec.power === "battery_usb" && battery && charger) ok.push("ok_battery_usb");
    else if (wantsBattery && battery) ok.push("ok_battery");
    else if (spec.power === "usb") ok.push("ok_usb");
    else if (spec.power === "mains_adapter") ok.push("ok_mains");
  }
  const powered = entries.some((e) => !isMcu(e.p) && !isPowerSource(e.p) && e.p.pins.some((x) => isPowerRole(x.role)));
  if (mcu && powered && !has("voltage", "logic_up", "logic_down", "unpowered")) ok.push("ok_voltage");
  const budgets = powerBudget(legacy);
  if (budgets.length && budgets.some((b) => b.loads.length) && !has("power_budget")) ok.push("ok_budget");
  if (mcu && entries.length > 1 && !has("pins_out")) ok.push("ok_pins");
  if (nets.some((n) => n.name === "GND")) ok.push("ok_ground");

  return [
    ...issues,
    ...ok.slice(0, 3).map((key) => ({ id: key, ok: true, plain: checkText(key, locale) })),
  ];
}
