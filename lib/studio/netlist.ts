// Design Studio wiring: DETERMINISTIC code, never AI.
//
// The picker (AI) only chooses parts from our library. Everything below turns
// that list into a circuit with plain rules over pin ROLES (never per part):
//   resolveRequired()  adds the helpers the parts need (a resistor per LED, a
//                      level shifter where a 5 V signal would reach a 3.3 V
//                      board, a driver for a motor) when the library has them;
//   buildNetlist()     power topology, shared buses, one board pin per signal;
//   toLegacyNetlist()  the lib/prototyping/netlist.ts shape, so the existing
//                      rule engine (hardRules / sanityChecks / powerBudget) and
//                      the firmware generator work on Studio circuits unchanged;
//   buildWiring()      the one call the API and UI use.
//
// Pure and client-safe. Same input → same output, byte for byte.

import type {
  Netlist as LegacyNetlist,
  NetComponent,
  PinType,
  PowerRail,
  ComponentRole,
} from "@/lib/prototyping/netlist";
import type { LibraryPart, Net, Pin, PinRole, ProductSpec, StudioCheck, StudioComponent } from "./schema";
import { studioChecks } from "./plain-checks";

export type GetPart = (id: string) => LibraryPart | undefined;
export type Locale = "en" | "ar";

// ── Part classification (tags / roles only, generic over the library) ──────

const POWER_ROLES: ReadonlySet<PinRole> = new Set<PinRole>(["vin", "3v3", "5v"]);
export const isPowerRole = (r: PinRole) => POWER_ROLES.has(r);
export const isSignalRole = (r: PinRole) => !POWER_ROLES.has(r) && r !== "gnd";

const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "_");
/** A tag (or a whole `_`-separated word run of the id) equals one of `words`. */
export function tagged(p: LibraryPart, words: readonly string[]): boolean {
  const tags = p.tags.map(norm);
  const id = `_${p.id}_`;
  return words.some((w) => tags.includes(w) || id.includes(`_${w}_`));
}

export const isMcu = (p: LibraryPart) => p.category === "mcu";
export const isCharger = (p: LibraryPart) => p.category === "power" && tagged(p, ["charger", "tp4056"]);
export const isBattery = (p: LibraryPart) =>
  p.category === "power" && !isCharger(p) && tagged(p, ["battery", "cell", "lipo", "li_ion", "18650"]);
export const isShifter = (p: LibraryPart) => tagged(p, ["level_shifter", "shifter", "logic_level", "logic_level_converter"]);
/** A regulator / buck / boost: a vin pin in, a 3v3 or 5v pin out. */
export const isConverter = (p: LibraryPart) =>
  p.category === "power" &&
  !isBattery(p) &&
  !isCharger(p) &&
  p.pins.some((x) => x.role === "vin") &&
  p.pins.some((x) => x.role === "3v3" || x.role === "5v");
/** Battery, charger or converter: wired by the power plan, not as a load. */
export const isPowerSource = (p: LibraryPart) => isBattery(p) || isCharger(p) || isConverter(p);

export type SymbolKind = "resistor" | "led" | "diode";
/** Two-legged parts drawn as a schematic symbol (resistor zigzag, LED triangle). */
export function symbolKind(p: LibraryPart): SymbolKind | null {
  if (p.pins.length !== 2 || p.pins.some((x) => isPowerRole(x.role))) return null;
  if (tagged(p, ["resistor"])) return "resistor";
  if (tagged(p, ["led"])) return "led";
  if (tagged(p, ["diode"])) return "diode";
  return null;
}
/** A helper that sits in series on its host's signal line (a resistor). */
export const isSeriesHelper = (p: LibraryPart) => symbolKind(p) === "resistor";
export const isButton = (p: LibraryPart) =>
  tagged(p, ["button", "switch", "pushbutton", "push_button"]) && !p.pins.some((x) => x.role === "gnd" || isPowerRole(x.role));
export const isInductive = (p: LibraryPart) =>
  tagged(p, ["motor", "solenoid", "pump", "relay", "relay_coil", "fan", "coil"]) &&
  !tagged(p, ["module", "driver", "servo", "stepper", "relay_module"]);
export const isDriver = (p: LibraryPart) =>
  tagged(p, ["driver", "mosfet", "transistor", "relay_module", "h_bridge"]) ||
  (tagged(p, ["relay"]) && tagged(p, ["module"]));
const wantsPwm = (p: LibraryPart) => tagged(p, ["pwm", "servo", "buzzer", "dimmable", "dimmer", "speaker"]);
const isAnalog = (p: LibraryPart) => tagged(p, ["analog", "analogue"]);

/** Helper part ids we add when the library has them (skipped silently otherwise). */
export const LEVEL_SHIFTER_IDS = ["level_shifter_4ch", "level_shifter"] as const;
export const DRIVER_IDS = ["mosfet_driver", "mosfet_module", "motor_driver", "relay_module"] as const;
export const BOOSTER_IDS = ["boost_5v"] as const;

// ── Entries ─────────────────────────────────────────────────────────────────

type Entry = { c: StudioComponent; p: LibraryPart };
const ref = (inst: string, pin: string) => `${inst}.${pin}`;
/** "esp32_devkit_1.GPIO21" → ["esp32_devkit_1", "GPIO21"]. */
export function splitRef(r: string): [string, string] {
  const i = r.indexOf(".");
  return i < 0 ? [r, ""] : [r.slice(0, i), r.slice(i + 1)];
}

function entriesOf(components: StudioComponent[], getPart: GetPart): Entry[] {
  const out: Entry[] = [];
  for (const c of components) {
    const p = getPart(c.partId);
    if (p) out.push({ c, p });
  }
  return out;
}

// ── Charger pins (by label, the roles of a charger board are not uniform) ──

export type ChargerPins = { bat?: Pin; out?: Pin; inp?: Pin; batGnd?: Pin; outGnd: Pin[]; inGnd?: Pin };
export function chargerPins(p: LibraryPart): ChargerPins {
  const txt = (x: Pin) => `${x.id} ${x.label}`.toUpperCase();
  const isBatSide = (x: Pin) => /(^|[^A-Z])B(AT|ATT)?[_ ]?(\+|PLUS|-|MINUS)|BATTERY/.test(txt(x));
  const isIn = (x: Pin) => /(^|[^A-Z])IN([_ +-]|PLUS|MINUS|$)|USB/.test(txt(x)) && !/OUT/.test(txt(x));
  const pos = p.pins.filter((x) => x.role !== "gnd");
  const gnd = p.pins.filter((x) => x.role === "gnd");
  const bat = pos.find(isBatSide) ?? pos.find((x) => !isIn(x) && !/OUT/.test(txt(x)));
  const out = pos.find((x) => x !== bat && /OUT/.test(txt(x)));
  const inp = pos.find((x) => x !== bat && x !== out && isIn(x));
  const batGnd = gnd.find(isBatSide);
  const inGnd = gnd.find((x) => x !== batGnd && isIn(x));
  return { bat, out, inp, batGnd, inGnd, outGnd: gnd.filter((x) => x !== batGnd && x !== inGnd) };
}

/** Level shifter channels: low-side and high-side signal pins, paired in order. */
export function shifterChannels(p: LibraryPart): { low: Pin; high: Pin }[] {
  const sig = p.pins.filter((x) => isSignalRole(x.role));
  const isLow = (x: Pin) => /^L/i.test(x.id) || /^LV/i.test(x.label) || (x.voltage !== undefined && x.voltage < 4);
  const isHigh = (x: Pin) => /^H/i.test(x.id) || /^HV/i.test(x.label) || (x.voltage !== undefined && x.voltage >= 4.5);
  const low = sig.filter((x) => isLow(x) && !isHigh(x));
  const high = sig.filter((x) => isHigh(x) && !isLow(x));
  const n = Math.min(low.length, high.length);
  return Array.from({ length: n }, (_, i) => ({ low: low[i], high: high[i] }));
}

// ── Power plan ──────────────────────────────────────────────────────────────

export type Rail = {
  /** Net the rail lives on ("3V3", "5V", or a supply net when the board is fed through that pin). */
  net: string;
  v: number;
  /** The MCU pin ref on the rail. */
  pin: string;
  /** True when the board supplies this rail (a power_out pin). */
  fromMcu: boolean;
};

type PowerPlan = {
  rails: { "3V3"?: Rail; "5V"?: Rail };
  /** Supply nets in order (VBAT, BAT-, VSYS, VREG), pins included. */
  supply: { name: string; pins: string[] }[];
  /** Pin refs the plan wired (or deliberately left open). */
  handled: Set<string>;
  /** Pins of power parts that go to GND. */
  ground: string[];
  /** MCU pin fed by the battery chain, and whether its range suits the supply. */
  feed?: { pin: string; ok: boolean };
  /** Supply nominal voltage and max (battery chain), when one exists. */
  supplyV?: { nominal: number; max: number };
};

export const RAIL_RANGE: Record<"vin" | "5v" | "3v3", (mcu: LibraryPart) => [number, number]> = {
  vin: (m) => [m.power.vMin, m.power.vMax],
  "5v": () => [4.5, 5.5],
  "3v3": () => [3.0, 3.6],
};

function planPower(entries: Entry[], mcu: Entry | undefined): PowerPlan {
  const plan: PowerPlan = { rails: {}, supply: [], handled: new Set(), ground: [] };
  const firstPin = (e: Entry, role: PinRole) => e.p.pins.find((x) => x.role === role);

  // The battery chain: cell → charger (if any) → converter (if any) → board.
  const bat = entries.find((e) => isBattery(e.p));
  const chg = entries.find((e) => isCharger(e.p));
  const conv = entries.find((e) => isConverter(e.p));
  let node: { name: string; pins: string[] } | undefined;
  if (bat) {
    const plus = bat.p.pins.find((x) => x.role !== "gnd");
    const minus = bat.p.pins.find((x) => x.role === "gnd");
    const vbat = { name: "VBAT", pins: plus ? [ref(bat.c.instanceId, plus.id)] : [] };
    plan.supply.push(vbat);
    node = vbat;
    plan.supplyV = { nominal: plus?.voltage ?? (bat.p.power.vMin + bat.p.power.vMax) / 2, max: bat.p.power.vMax };
    for (const x of bat.p.pins) plan.handled.add(ref(bat.c.instanceId, x.id));
    if (chg) {
      const cp = chargerPins(chg.p);
      for (const x of chg.p.pins) plan.handled.add(ref(chg.c.instanceId, x.id));
      if (cp.bat) vbat.pins.push(ref(chg.c.instanceId, cp.bat.id));
      if (minus && cp.batGnd) {
        plan.supply.push({ name: "BAT-", pins: [ref(bat.c.instanceId, minus.id), ref(chg.c.instanceId, cp.batGnd.id)] });
      } else if (minus) plan.ground.push(ref(bat.c.instanceId, minus.id));
      for (const g of cp.outGnd) plan.ground.push(ref(chg.c.instanceId, g.id));
      if (cp.out) {
        node = { name: "VSYS", pins: [ref(chg.c.instanceId, cp.out.id)] };
        plan.supply.push(node);
      }
    } else if (minus) plan.ground.push(ref(bat.c.instanceId, minus.id));
    if (conv) {
      const vin = firstPin(conv, "vin");
      const out = conv.p.pins.find((x) => x.role === "5v" || x.role === "3v3");
      for (const x of conv.p.pins) plan.handled.add(ref(conv.c.instanceId, x.id));
      for (const g of conv.p.pins.filter((x) => x.role === "gnd")) plan.ground.push(ref(conv.c.instanceId, g.id));
      if (vin && out) {
        node.pins.push(ref(conv.c.instanceId, vin.id));
        node = { name: "VREG", pins: [ref(conv.c.instanceId, out.id)] };
        plan.supply.push(node);
        const v = out.voltage ?? (out.role === "5v" ? 5 : 3.3);
        plan.supplyV = { nominal: v, max: v };
      }
    }
  }

  if (!mcu) return plan;
  const m = mcu.c.instanceId;
  const p3 = firstPin(mcu, "3v3");
  const p5 = firstPin(mcu, "5v");
  const pv = firstPin(mcu, "vin");

  // Feed the board from the chain: the first pin whose range takes the supply.
  let feedRole: "vin" | "5v" | "3v3" | undefined;
  if (node && plan.supplyV) {
    const { nominal, max } = plan.supplyV;
    const cands: ["vin" | "5v" | "3v3", Pin | undefined][] = [["vin", pv], ["5v", p5], ["3v3", p3]];
    const fit = cands.find(([role, pin]) => {
      if (!pin) return false;
      const [lo, hi] = RAIL_RANGE[role](mcu.p);
      return nominal >= lo && nominal <= hi && max <= hi;
    });
    const chosen = fit ?? cands.find(([, pin]) => !!pin);
    if (chosen && chosen[1]) {
      feedRole = chosen[0];
      const r = ref(m, chosen[1].id);
      node.pins.push(r);
      plan.feed = { pin: r, ok: !!fit };
    }
  }

  // Rails the peripherals can use.
  if (p3) {
    plan.rails["3V3"] = feedRole === "3v3"
      ? { net: node!.name, v: plan.supplyV!.nominal, pin: ref(m, p3.id), fromMcu: false }
      : { net: "3V3", v: p3.voltage ?? 3.3, pin: ref(m, p3.id), fromMcu: true };
  }
  if (p5) {
    plan.rails["5V"] = feedRole === "5v"
      ? { net: node!.name, v: plan.supplyV!.nominal, pin: ref(m, p5.id), fromMcu: false }
      : { net: "5V", v: p5.voltage ?? 5, pin: ref(m, p5.id), fromMcu: true };
  } else if (pv) {
    // A board without a 5V pin passes its USB 5 V out on VIN (ESP32 DevKit).
    plan.rails["5V"] = feedRole === "vin"
      ? { net: node!.name, v: plan.supplyV!.nominal, pin: ref(m, pv.id), fromMcu: false }
      : { net: "5V", v: pv.voltage ?? 5, pin: ref(m, pv.id), fromMcu: true };
  }
  return plan;
}

/** The rail a power pin of `p` goes on, or undefined when no rail suits it. */
function railFor(pin: Pin, p: LibraryPart, plan: PowerPlan, mcuLogic: number): Rail | undefined {
  const inRange = (r: Rail | undefined) => !!r && r.v >= p.power.vMin - 1e-6 && r.v <= p.power.vMax + 1e-6;
  const r3 = plan.rails["3V3"];
  const r5 = plan.rails["5V"];
  if (pin.role === "3v3") return inRange(r3) ? r3 : undefined;
  if (pin.role === "5v") return inRange(r5) ? r5 : undefined;
  const prefer = mcuLogic >= 4.5 ? [r5, r3] : [r3, r5];
  return prefer.find(inRange);
}

/** Logic level a part's signals swing at once powered: 5 V only on a ≥4.5 V rail. */
function effectiveLogic(e: Entry, plan: PowerPlan, mcuLogic: number): number {
  const pp = e.p.pins.find((x) => isPowerRole(x.role));
  if (!pp) return mcuLogic;
  const r = railFor(pp, e.p, plan, mcuLogic);
  if (!r) return e.p.power.logicV;
  return r.v >= 4.5 ? e.p.power.logicV : Math.min(e.p.power.logicV, 3.3);
}

export const DEV_TO_MCU: ReadonlySet<PinRole> = new Set<PinRole>(["out", "gpio", "uart_tx", "i2c_sda", "i2c_scl", "spi_miso"]);
export const MCU_TO_DEV: ReadonlySet<PinRole> = new Set<PinRole>([
  "in", "gpio", "uart_rx", "i2c_sda", "i2c_scl", "spi_mosi", "spi_sck", "spi_cs", "pwm",
]);
const BUS_NET: Partial<Record<PinRole, string>> = {
  i2c_sda: "SDA", i2c_scl: "SCL", spi_mosi: "MOSI", spi_miso: "MISO", spi_sck: "SCK",
};

type ShiftDir = "dev_to_mcu" | "mcu_to_dev";
/** Whether a peripheral pin needs a level shifter between it and the board. */
function shiftNeed(e: Entry, pin: Pin, plan: PowerPlan, mcuLogic: number): ShiftDir | null {
  if (isAnalog(e.p) && pin.role === "out") return null;
  if (pin.role === "adc") return null;
  const eff = effectiveLogic(e, plan, mcuLogic);
  if (mcuLogic < 4 && eff >= 4.5 && DEV_TO_MCU.has(pin.role)) return "dev_to_mcu";
  if (mcuLogic >= 4.5 && eff < 4 && e.p.power.vMax < 4.5 && MCU_TO_DEV.has(pin.role)) return "mcu_to_dev";
  return null;
}

/** A part wired as a load: not the board, a supply, a shifter or a series helper. */
function isPeripheral(e: Entry): boolean {
  return !isMcu(e.p) && !isPowerSource(e.p) && !isShifter(e.p) && !isSeriesHelper(e.p);
}

/** Distinct shifter channels the circuit needs (bus lines count once). */
function shiftKeys(entries: Entry[], plan: PowerPlan, mcu: Entry | undefined): string[] {
  if (!mcu) return [];
  const keys: string[] = [];
  for (const e of entries.filter(isPeripheral)) {
    if (symbolKind(e.p) || isButton(e.p)) continue;
    for (const pin of e.p.pins) {
      if (!isSignalRole(pin.role) || !shiftNeed(e, pin, plan, mcu.p.power.logicV)) continue;
      const k = BUS_NET[pin.role] ?? ref(e.c.instanceId, pin.id);
      if (!keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

// ── resolveRequired ─────────────────────────────────────────────────────────

export type AddedComponent = { instanceId: string; partId: string; reasonKey: AddedReason };
export type AddedReason = "resistor" | "level_shifter" | "driver" | "booster" | "required";

/** Why an added part is there, in plain words (also used for StudioComponent.reason). */
export const ADDED_REASON: Record<AddedReason, Record<Locale, string>> = {
  resistor: { en: "Keeps the light from burning out.", ar: "يحمي الضوء من الاحتراق." },
  level_shifter: {
    en: "Lets a 5 V part talk safely to the board.",
    ar: "يتيح لقطعة تعمل بـ 5 فولت أن تتواصل مع اللوحة بأمان.",
  },
  driver: { en: "Lets the board switch the motor safely.", ar: "يتيح للوحة تشغيل المحرّك بأمان." },
  booster: {
    en: "Raises the battery to 5 V so every part gets enough power.",
    ar: "يرفع جهد البطارية إلى 5 فولت لتحصل كل قطعة على طاقة كافية.",
  },
  required: { en: "Another part needs it to work safely.", ar: "تحتاجها قطعة أخرى لتعمل بأمان." },
};

/**
 * Adds the parts the chosen parts need: each part's `requires` (one per
 * instance), a level shifter per 4 signals that would cross 5 V ↔ 3.3 V, and a
 * driver per inductive load without one. Helpers missing from the library are
 * skipped silently. Added components get auto:true; ids are `${partId}_${n}`.
 */
export function resolveRequired(
  components: StudioComponent[],
  getPart: GetPart,
): { components: StudioComponent[]; added: AddedComponent[] } {
  const out = components.map((c) => ({ ...c }));
  const added: AddedComponent[] = [];
  const used = new Set(out.map((c) => c.instanceId));
  const add = (part: LibraryPart, reasonKey: AddedReason, reason?: string) => {
    let n = 1;
    while (used.has(`${part.id}_${n}`)) n++;
    const instanceId = `${part.id}_${n}`;
    used.add(instanceId);
    out.push({
      partId: part.id,
      instanceId,
      label: part.name.en,
      reason: reason ?? ADDED_REASON[reasonKey].en,
      auto: true,
    });
    added.push({ instanceId, partId: part.id, reasonKey });
  };
  const firstFound = (ids: readonly string[]) => ids.map(getPart).find((p): p is LibraryPart => !!p);

  // 1. Drivers for inductive loads (motor, pump, solenoid, bare relay coil).
  const ents = () => entriesOf(out, getPart);
  const loads = ents().filter((e) => isInductive(e.p)).length;
  const drivers = ents().filter((e) => isDriver(e.p)).length;
  const driver = firstFound(DRIVER_IDS);
  if (driver) for (let i = drivers; i < loads; i++) add(driver, "driver");

  // 1b. A 5 V booster when a battery can't reach what a part needs and no converter is there.
  const booster = firstFound(BOOSTER_IDS);
  if (booster) {
    const e = ents();
    const batteries = e.filter((x) => isBattery(x.p));
    if (batteries.length > 0 && !e.some((x) => isConverter(x.p))) {
      const batteryMax = Math.max(...batteries.map((x) => x.p.power.vMax));
      const starved = e.some((x) => !isPowerSource(x.p) && !symbolKind(x.p) && x.p.power.vMin > batteryMax);
      if (starved) add(booster, "booster");
    }
  }

  // 2. `requires`, one per instance of the requiring part; repeat for what the added parts require.
  for (let round = 0; round < 3; round++) {
    const need = new Map<string, { count: number; reason: string }>();
    for (const e of ents()) {
      for (const r of e.p.requires ?? []) {
        if (!getPart(r.id)) continue;
        const cur = need.get(r.id) ?? { count: 0, reason: r.reason };
        cur.count++;
        need.set(r.id, cur);
      }
    }
    let changed = false;
    for (const [id, { count, reason }] of need) {
      const part = getPart(id)!;
      const have = out.filter((c) => c.partId === id).length;
      for (let i = have; i < count; i++) {
        add(part, symbolKind(part) === "resistor" ? "resistor" : "required", reason);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 3. Level shifters for signals crossing 5 V ↔ 3.3 V.
  const shifter = firstFound(LEVEL_SHIFTER_IDS);
  if (shifter) {
    const e = ents();
    const mcu = e.find((x) => isMcu(x.p));
    const keys = shiftKeys(e, planPower(e, mcu), mcu);
    const perShifter = Math.max(1, shifterChannels(shifter).length);
    const have = e.filter((x) => isShifter(x.p)).length;
    const needN = Math.ceil(keys.length / perShifter);
    for (let i = have; i < needN; i++) add(shifter, "level_shifter");
  }
  return { components: out, added };
}

// ── buildNetlist ────────────────────────────────────────────────────────────

class NetBook {
  private order: string[] = [];
  private pins = new Map<string, string[]>();
  private pinNet = new Map<string, string>();
  has(name: string) {
    return this.pins.has(name);
  }
  ensure(name: string) {
    if (!this.pins.has(name)) {
      this.pins.set(name, []);
      this.order.push(name);
    }
  }
  add(name: string, pinRef: string): boolean {
    if (this.pinNet.has(pinRef)) return false;
    this.ensure(name);
    this.pins.get(name)!.push(pinRef);
    this.pinNet.set(pinRef, name);
    return true;
  }
  netOf(pinRef: string) {
    return this.pinNet.get(pinRef);
  }
  /** `base`, or `base_2`, `base_3`… when taken. */
  fresh(base: string): string {
    if (!this.pins.has(base)) return base;
    let n = 2;
    while (this.pins.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }
  result(): Net[] {
    return this.order
      .map((name) => ({ name, pins: [...this.pins.get(name)!] }))
      .filter((n) => n.pins.length >= 2);
  }
}

type PinKind = "dout" | "din" | "din_pull" | "adc" | "pwm";

class PinPool {
  private used = new Set<string>();
  constructor(private mcu: Entry | undefined, private busy: { i2c: boolean; spi: boolean }) {}
  take(pinId: string) {
    this.used.add(pinId);
  }
  isFree(pinId: string) {
    return !this.used.has(pinId);
  }
  /** First free pin of `role`. */
  role(role: PinRole): Pin | undefined {
    const p = this.mcu?.p.pins.find((x) => x.role === role && !this.used.has(x.id));
    if (p) this.used.add(p.id);
    return p;
  }
  /** A free board pin for a signal, in the board's pin order, tiered by role. */
  alloc(kind: PinKind): Pin | undefined {
    if (!this.mcu) return undefined;
    const pins = this.mcu.p.pins;
    const hasPwm = pins.some((x) => x.role === "pwm");
    const spare: PinRole[] = [
      ...(this.busy.i2c ? [] : (["i2c_sda", "i2c_scl"] as PinRole[])),
      ...(this.busy.spi ? [] : (["spi_cs", "spi_sck", "spi_mosi", "spi_miso"] as PinRole[])),
    ];
    const tiers: PinRole[][] =
      kind === "adc" ? [["adc"]]
      : kind === "pwm" ? (hasPwm ? [["pwm"]] : [["gpio"], spare])
      : kind === "din" ? [["gpio"], ["pwm"], spare, ["adc"]]
      : [["gpio"], ["pwm"], spare];
    for (const tier of tiers) {
      const p = pins.find((x) => tier.includes(x.role) && !this.used.has(x.id));
      if (p) {
        this.used.add(p.id);
        return p;
      }
    }
    return undefined;
  }
}

const labelCode = (s: string) => s.toUpperCase().replace(/\(.*?\)/g, "").replace(/[^A-Z0-9]+/g, "") || "SIG";

/** Short net codes per instance: BTN1, LED1, PIR, DHT22, OLED2… */
function netCodes(entries: Entry[]): Map<string, { code: string; numbered: boolean }> {
  const base = (e: Entry) =>
    isButton(e.p) ? "BTN" : symbolKind(e.p) === "led" ? "LED" : labelCode(e.p.id.split("_").find((w) => w.length >= 3) ?? e.p.id);
  const count = new Map<string, number>();
  for (const e of entries) count.set(base(e), (count.get(base(e)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, { code: string; numbered: boolean }>();
  for (const e of entries) {
    const b = base(e);
    const k = (seen.get(b) ?? 0) + 1;
    seen.set(b, k);
    const numbered = b === "BTN" || b === "LED";
    out.set(e.c.instanceId, { code: numbered || count.get(b)! > 1 ? `${b}${k}` : b, numbered });
  }
  return out;
}

export type BuildResult = {
  nets: Net[];
  /** Pin refs we could not connect (board out of pins, no suitable rail, no board). */
  unconnected: string[];
};

/**
 * Deterministic wiring. Power first (battery chain → board, board rails →
 * peripherals, every ground on GND), then buses (I2C/SPI shared, UART
 * crossed), then one free board pin per remaining signal, in the board's pin
 * order. Helpers in series (resistor) go between the board pin and their host.
 * `spec` is accepted for topology choices; the parts present decide today.
 */
export function buildNetlist(components: StudioComponent[], spec: ProductSpec, getPart: GetPart): BuildResult {
  void spec;
  const entries = entriesOf(components, getPart);
  const mcu = entries.find((e) => isMcu(e.p));
  const mcuLogic = mcu?.p.power.logicV ?? 3.3;
  const plan = planPower(entries, mcu);
  const nb = new NetBook();
  const unconnected: string[] = [];

  // Power nets in a fixed order.
  for (const s of plan.supply) for (const r of s.pins) nb.add(s.name, r);
  for (const key of ["3V3", "5V"] as const) {
    const rail = plan.rails[key];
    if (rail) nb.add(rail.net, rail.pin);
  }
  nb.ensure("GND");
  if (mcu) {
    const g = mcu.p.pins.find((x) => x.role === "gnd");
    if (g) nb.add("GND", ref(mcu.c.instanceId, g.id));
  }
  for (const r of plan.ground) nb.add("GND", r);

  // Pairings: series helpers to their hosts, drivers to their loads.
  const claimed = new Set<string>();
  const seriesOf = new Map<string, Entry[]>();
  for (const e of entries) {
    for (const req of e.p.requires ?? []) {
      const h = entries.find((x) => x.c.partId === req.id && !claimed.has(x.c.instanceId) && isSeriesHelper(x.p));
      if (!h) continue;
      claimed.add(h.c.instanceId);
      seriesOf.set(e.c.instanceId, [...(seriesOf.get(e.c.instanceId) ?? []), h]);
    }
  }
  const driverOf = new Map<string, Entry>();
  const loadOf = new Map<string, Entry>();
  for (const load of entries.filter((e) => isInductive(e.p))) {
    const d = entries.find((x) => isDriver(x.p) && !loadOf.has(x.c.instanceId));
    if (!d) continue;
    driverOf.set(load.c.instanceId, d);
    loadOf.set(d.c.instanceId, load);
  }

  const loadTarget = (l: Entry) =>
    l.p.pins.find((x) => x.role === "in" || x.role === "gpio" || x.role === "pwm") ?? l.p.pins.find((x) => isPowerRole(x.role));

  // Peripherals and helpers: power pins and grounds.
  for (const e of entries) {
    if (isMcu(e.p) || isPowerSource(e.p)) continue;
    const driven = driverOf.has(e.c.instanceId) ? loadTarget(e) : undefined;
    for (const pin of e.p.pins) {
      const r = ref(e.c.instanceId, pin.id);
      if (pin === driven) continue;
      if (pin.role === "gnd") nb.add("GND", r);
      else if (isPowerRole(pin.role)) {
        const rail = railFor(pin, e.p, plan, mcuLogic);
        if (rail) nb.add(rail.net, r);
        else unconnected.push(r);
      }
    }
  }

  const peripherals = entries.filter((e) => isPeripheral(e) && !claimed.has(e.c.instanceId));
  const codes = netCodes(peripherals);
  const busy = {
    i2c: peripherals.some((e) => e.p.pins.some((x) => x.role === "i2c_sda" || x.role === "i2c_scl")),
    spi: peripherals.some((e) => e.p.pins.some((x) => x.role.startsWith("spi_"))),
  };
  const pool = new PinPool(mcu, busy);
  const busPins = new Map<string, string | null>();
  /** The MCU end of a shared bus line, allocated once (role pin, else a spare gpio). */
  const busEnd = (line: string, role: PinRole): string | null => {
    if (busPins.has(line)) return busPins.get(line)!;
    if (!mcu) return null;
    const p = pool.role(role) ?? pool.alloc(line === "MISO" ? "din" : "dout");
    const r = p ? ref(mcu.c.instanceId, p.id) : null;
    if (r) nb.add(line, r);
    busPins.set(line, r);
    return r;
  };

  type Pending = { mcuNet: string; dev: string; dir: ShiftDir };
  const pending: Pending[] = [];
  /** Attach a device pin to an MCU-side net, through a shifter when the levels differ. */
  const attach = (mcuNet: string, e: Entry, pin: Pin) => {
    const r = ref(e.c.instanceId, pin.id);
    const dir = mcu ? shiftNeed(e, pin, plan, mcuLogic) : null;
    if (dir) pending.push({ mcuNet, dev: r, dir });
    else nb.add(mcuNet, r);
  };
  /** A fresh net from a newly allocated board pin. */
  const fromBoard = (name: string, kind: PinKind): string | null => {
    if (!mcu) return null;
    const p = pool.alloc(kind);
    if (!p) return null;
    const net = nb.fresh(name);
    nb.add(net, ref(mcu.c.instanceId, p.id));
    return net;
  };

  for (const e of peripherals) {
    const inst = e.c.instanceId;
    const { code, numbered } = codes.get(inst)!;
    const signals = e.p.pins.filter((x) => isSignalRole(x.role));
    const nameFor = (pin: Pin) =>
      numbered && signals.length === 1 ? code : `${code}_${labelCode(pin.label.split(/[\s(/]/)[0] || pin.id)}`;

    // A button: one leg to a board pin (internal pull-up), the other to GND.
    if (isButton(e.p)) {
      const sig = signals.find((x) => x.role === "out") ?? signals[0];
      for (const pin of signals) {
        if (pin !== sig) nb.add("GND", ref(inst, pin.id));
      }
      if (sig) {
        const net = fromBoard(numbered ? code : `${code}_${labelCode(sig.id)}`, "din_pull");
        if (net) nb.add(net, ref(inst, sig.id));
        else unconnected.push(ref(inst, sig.id));
      }
      continue;
    }

    const helpers = seriesOf.get(inst) ?? [];
    const load = loadOf.get(inst);
    const driver = driverOf.get(inst);
    let seriesDone = false;

    for (const pin of signals) {
      const r = ref(inst, pin.id);
      if (nb.netOf(r)) continue;
      // A driver's output goes to its load.
      if (load && (pin.role === "out")) {
        const t = loadTarget(load);
        if (t) {
          const net = nb.fresh(`${codes.get(load.c.instanceId)?.code ?? "LOAD"}_${labelCode(t.label.split(/[\s(/]/)[0] || t.id)}`);
          nb.add(net, r);
          nb.add(net, ref(load.c.instanceId, t.id));
          continue;
        }
      }
      // A load's input comes from its driver (wired above or below).
      if (driver) {
        const t = loadTarget(e);
        if (t && t.id === pin.id) continue;
      }
      // Buses.
      const line = BUS_NET[pin.role];
      if (line) {
        const end = busEnd(line, pin.role);
        if (end) attach(nb.netOf(end)!, e, pin);
        else unconnected.push(r);
        continue;
      }
      if (pin.role === "uart_tx" || pin.role === "uart_rx") {
        const mp = mcu ? pool.role(pin.role === "uart_tx" ? "uart_rx" : "uart_tx") ?? pool.alloc(pin.role === "uart_tx" ? "din" : "dout") : undefined;
        if (!mp || !mcu) {
          unconnected.push(r);
          continue;
        }
        const net = nb.fresh(nameFor(pin));
        nb.add(net, ref(mcu.c.instanceId, mp.id));
        attach(net, e, pin);
        continue;
      }
      const kind: PinKind =
        pin.role === "adc" ? "adc"
        : pin.role === "pwm" ? "pwm"
        : pin.role === "out" ? (isAnalog(e.p) ? "adc" : "din")
        : pin.role === "in" || pin.role === "gpio" ? (wantsPwm(e.p) ? "pwm" : "dout")
        : "dout"; // spi_cs and anything else the board drives
      const name = nameFor(pin);
      const net = fromBoard(name, kind);
      if (!net) {
        unconnected.push(r);
        continue;
      }
      // Series helpers (resistor) between the board pin and the host's first signal pin.
      if (!seriesDone && helpers.length) {
        seriesDone = true;
        let cur = net;
        helpers.forEach((h, i) => {
          const [a, b] = h.p.pins;
          nb.add(cur, ref(h.c.instanceId, a.id));
          cur = nb.fresh(i === helpers.length - 1 ? `${net}_${labelCode(pin.id)}` : `${net}_${i + 2}`);
          nb.add(cur, ref(h.c.instanceId, b.id));
        });
        nb.add(cur, r);
        continue;
      }
      attach(net, e, pin);
    }
  }

  // Level shifters: one channel per MCU-side net; spare devices go direct (and are flagged by the checks).
  const shifters = entries.filter((e) => isShifter(e.p));
  const channels = shifters.flatMap((s) => shifterChannels(s.p).map((ch) => ({ s, ...ch })));
  const groups: { mcuNet: string; dir: ShiftDir; devs: string[] }[] = [];
  for (const p of pending) {
    const g = groups.find((x) => x.mcuNet === p.mcuNet);
    if (g) g.devs.push(p.dev);
    else groups.push({ mcuNet: p.mcuNet, dir: p.dir, devs: [p.dev] });
  }
  for (const g of groups) {
    const ch = channels.shift();
    if (!ch) {
      for (const d of g.devs) nb.add(g.mcuNet, d);
      continue;
    }
    const s = ch.s.c.instanceId;
    const devNet = nb.fresh(`${g.mcuNet}_${g.dir === "dev_to_mcu" ? "5V" : "3V3"}`);
    const mcuSide = g.dir === "dev_to_mcu" ? ch.low : ch.high;
    const devSide = g.dir === "dev_to_mcu" ? ch.high : ch.low;
    nb.add(g.mcuNet, ref(s, mcuSide.id));
    nb.add(devNet, ref(s, devSide.id));
    for (const d of g.devs) nb.add(devNet, d);
  }

  // Anything a peripheral still has open that should have been wired.
  for (const e of peripherals) {
    for (const pin of e.p.pins) {
      const r = ref(e.c.instanceId, pin.id);
      if (!nb.netOf(r) && !unconnected.includes(r)) unconnected.push(r);
    }
  }
  return { nets: nb.result(), unconnected };
}

// ── toLegacyNetlist ─────────────────────────────────────────────────────────

const CHIP_NAMES: [RegExp, string][] = [
  [/esp32/i, "ESP32"],
  [/esp8266/i, "ESP8266"],
  [/\buno\b|arduino_uno/i, "Arduino Uno"],
  [/\bnano\b|arduino_nano/i, "Arduino Nano"],
  [/\bmega\b|arduino_mega/i, "Arduino Mega"],
  [/pico|rp2040/i, "Raspberry Pi Pico"],
];

/** The `function` text the legacy rules and the firmware generator read. */
export function legacyFunction(p: LibraryPart): string {
  if (isMcu(p)) {
    const hay = `${p.id} ${p.name.en} ${p.tags.join(" ")}`;
    const chip = CHIP_NAMES.find(([re]) => re.test(hay))?.[1] ?? p.name.en;
    return `${chip} microcontroller board`;
  }
  const k = symbolKind(p);
  if (k === "led") return `LED indicator (${p.name.en.replace(/resist\w*/gi, "")})`.replace(/\s+\)/, ")");
  if (k === "resistor") return `Resistor (${p.name.en})`;
  // Keep the legacy regexes from mistaking other parts for an LED or a resistor.
  const name = p.name.en.replace(/\bLEDs?\b/gi, "light").replace(/resist\w*/gi, "protected");
  return `${name} (${p.category})`;
}

function legacyRole(p: LibraryPart): ComponentRole {
  if (isInductive(p)) return "inductive_load";
  if (isDriver(p)) return "driver";
  return "other";
}

/**
 * The Studio circuit in lib/prototyping/netlist.ts form. Pin types come from
 * roles: a board's 3V3/5V pin is power_out unless the battery chain feeds it;
 * a battery / charger output is power_out; every other supply pin power_in;
 * two-legged parts without a supply pin (resistor, LED, button) are passive.
 */
export function toLegacyNetlist(components: StudioComponent[], nets: Net[], getPart: GetPart): LegacyNetlist {
  const entries = entriesOf(components, getPart);
  const netOf = new Map<string, string>();
  for (const n of nets) for (const r of n.pins) netOf.set(r, n.name);
  const supplyRefs = new Set<string>();
  for (const e of entries) {
    if (isBattery(e.p)) {
      const plus = e.p.pins.find((x) => x.role !== "gnd");
      if (plus) supplyRefs.add(ref(e.c.instanceId, plus.id));
    } else if (isCharger(e.p)) {
      const out = chargerPins(e.p).out;
      if (out) supplyRefs.add(ref(e.c.instanceId, out.id));
    } else if (isConverter(e.p)) {
      const out = e.p.pins.find((x) => x.role === "5v" || x.role === "3v3");
      if (out) supplyRefs.add(ref(e.c.instanceId, out.id));
    }
  }
  const netHasSupply = (net: string | undefined) =>
    !!net && [...supplyRefs].some((r) => netOf.get(r) === net);

  const components2: NetComponent[] = [];
  const rails: PowerRail[] = [];
  for (const e of entries) {
    const inst = e.c.instanceId;
    const passive =
      !isMcu(e.p) && !isPowerSource(e.p) && !e.p.pins.some((x) => isPowerRole(x.role)) && e.p.pins.length <= 2;
    const pins = e.p.pins.map((x) => {
      const r = ref(inst, x.id);
      let type: PinType;
      if (passive) type = "passive";
      else if (x.role === "gnd") type = "ground";
      else if (isMcu(e.p)) {
        const net = netOf.get(r);
        if (x.role === "3v3" || x.role === "5v") type = netHasSupply(net) ? "power_in" : "power_out";
        else if (x.role === "vin") {
          // VIN carries the USB 5 V out when nothing feeds it and loads hang on it.
          const loads = net ? nets.find((n) => n.name === net)!.pins.length > 1 : false;
          type = !netHasSupply(net) && loads ? "power_out" : "power_in";
        } else if (x.role === "out") type = "output";
        else if (x.role === "in") type = "input";
        else type = "bidirectional";
      } else if (isPowerSource(e.p)) {
        type = supplyRefs.has(r) ? "power_out" : isSignalRole(x.role) || isPowerRole(x.role) ? "power_in" : "passive";
      } else if (isPowerRole(x.role)) type = "power_in";
      else if (isDriver(e.p) && x.role === "out") type = "power_out"; // a driver feeds its load
      else if (x.role === "out" || x.role === "uart_tx" || x.role === "spi_miso" || x.role === "adc") type = "output";
      else if (x.role === "in" || x.role === "uart_rx" || x.role === "spi_mosi" || x.role === "spi_sck" || x.role === "spi_cs" || x.role === "pwm")
        type = "input";
      else type = "bidirectional";
      return { id: x.id, name: x.label, type };
    });
    components2.push({
      ref: inst,
      function: legacyFunction(e.p),
      bomId: e.p.id,
      pins,
      currentMa: e.p.power.mA,
      role: legacyRole(e.p),
    });
    if (isMcu(e.p)) {
      for (const pin of pins) {
        if (pin.type !== "power_out") continue;
        const net = netOf.get(ref(inst, pin.id));
        if (!net || rails.some((x) => x.name === net)) continue;
        const v = e.p.pins.find((x) => x.id === pin.id)!;
        const is3 = v.role === "3v3";
        rails.push({ name: net, sourceRef: inst, maxCurrentMa: is3 ? (e.p.power.logicV < 4 ? 500 : 50) : 450 });
      }
    }
  }
  return {
    components: components2,
    nets: nets.map((n) => ({ name: n.name, connections: n.pins.map((r) => { const [a, b] = splitRef(r); return { ref: a, pin: b }; }) })),
    powerRails: rails,
    notes: [],
  };
}

// ── buildWiring ─────────────────────────────────────────────────────────────

export type WiringResult = {
  components: StudioComponent[];
  netlist: { nets: Net[] };
  checks: StudioCheck[];
  legacy: LegacyNetlist;
  added: AddedComponent[];
  unconnected: string[];
};

/** resolveRequired → buildNetlist → toLegacyNetlist → plain checks. */
export function buildWiring(
  components: StudioComponent[],
  spec: ProductSpec,
  getPart: GetPart,
  locale: Locale,
): WiringResult {
  const resolved = resolveRequired(components, getPart);
  const addedIds = new Map(resolved.added.map((a) => [a.instanceId, a]));
  const all = resolved.components.map((c) => {
    const a = addedIds.get(c.instanceId);
    const p = getPart(c.partId);
    if (!a || !p) return c;
    const reason = a.reasonKey === "required" && locale === "en" ? c.reason : ADDED_REASON[a.reasonKey][locale];
    return { ...c, label: p.name[locale], reason };
  });
  const { nets, unconnected } = buildNetlist(all, spec, getPart);
  const legacy = toLegacyNetlist(all, nets, getPart);
  const checks = studioChecks(all, nets, legacy, spec, getPart, locale);
  return { components: all, netlist: { nets }, checks, legacy, added: resolved.added, unconnected };
}
