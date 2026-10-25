// Studio wiring, stage 1: the power plan (battery chain -> board, the rails
// peripherals use) and the level-shift rules that depend on it. Internal to the
// netlist modules; the public names are re-exported by ./netlist.
//
// Pure and client-safe.

import type { LibraryPart, Pin, PinRole } from "./schema";
import {
  DEV_TO_MCU,
  type Entry,
  MCU_TO_DEV,
  RAIL_RANGE,
  chargerPins,
  isAnalog,
  isBattery,
  isButton,
  isCharger,
  isConverter,
  isMcu,
  isPowerRole,
  isPowerSource,
  isSeriesHelper,
  isShifter,
  isSignalRole,
  ref,
  symbolKind,
} from "./netlist-parts";

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

export type PowerPlan = {
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


export function planPower(entries: Entry[], mcu: Entry | undefined): PowerPlan {
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
export function railFor(pin: Pin, p: LibraryPart, plan: PowerPlan, mcuLogic: number): Rail | undefined {
  const inRange = (r: Rail | undefined) => !!r && r.v >= p.power.vMin - 1e-6 && r.v <= p.power.vMax + 1e-6;
  const r3 = plan.rails["3V3"];
  const r5 = plan.rails["5V"];
  if (pin.role === "3v3") return inRange(r3) ? r3 : undefined;
  if (pin.role === "5v") return inRange(r5) ? r5 : undefined;
  const prefer = mcuLogic >= 4.5 ? [r5, r3] : [r3, r5];
  return prefer.find(inRange);
}

/** Logic level a part's signals swing at once powered: 5 V only on a ≥4.5 V rail. */
export function effectiveLogic(e: Entry, plan: PowerPlan, mcuLogic: number): number {
  const pp = e.p.pins.find((x) => isPowerRole(x.role));
  if (!pp) return mcuLogic;
  const r = railFor(pp, e.p, plan, mcuLogic);
  if (!r) return e.p.power.logicV;
  return r.v >= 4.5 ? e.p.power.logicV : Math.min(e.p.power.logicV, 3.3);
}

export const BUS_NET: Partial<Record<PinRole, string>> = {
  i2c_sda: "SDA", i2c_scl: "SCL", spi_mosi: "MOSI", spi_miso: "MISO", spi_sck: "SCK",
};

export type ShiftDir = "dev_to_mcu" | "mcu_to_dev";
/** Whether a peripheral pin needs a level shifter between it and the board. */
export function shiftNeed(e: Entry, pin: Pin, plan: PowerPlan, mcuLogic: number): ShiftDir | null {
  if (isAnalog(e.p) && pin.role === "out") return null;
  if (pin.role === "adc") return null;
  const eff = effectiveLogic(e, plan, mcuLogic);
  if (mcuLogic < 4 && eff >= 4.5 && DEV_TO_MCU.has(pin.role)) return "dev_to_mcu";
  if (mcuLogic >= 4.5 && eff < 4 && e.p.power.vMax < 4.5 && MCU_TO_DEV.has(pin.role)) return "mcu_to_dev";
  return null;
}

/** A part wired as a load: not the board, a supply, a shifter or a series helper. */
export function isPeripheral(e: Entry): boolean {
  return !isMcu(e.p) && !isPowerSource(e.p) && !isShifter(e.p) && !isSeriesHelper(e.p);
}

/** Distinct shifter channels the circuit needs (bus lines count once). */
export function shiftKeys(entries: Entry[], plan: PowerPlan, mcu: Entry | undefined): string[] {
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
