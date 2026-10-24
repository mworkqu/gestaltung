// Studio wiring, stage 2: resolveRequired() adds the helper parts the chosen
// parts need (drivers, a 5 V booster, `requires`, level shifters).
// Import from ./netlist.
//
// Pure and client-safe.

import type { LibraryPart, StudioComponent } from "./schema";
import {
  BOOSTER_IDS,
  DRIVER_IDS,
  type GetPart,
  HBRIDGE_DRIVER_IDS,
  LEVEL_SHIFTER_IDS,
  type Locale,
  SWITCH_DRIVER_IDS,
  driverSuits,
  entriesOf,
  isBattery,
  isConverter,
  isDriver,
  isInductive,
  isMcu,
  isOnOffLoad,
  isPowerSource,
  isShifter,
  shifterChannels,
  symbolKind,
} from "./netlist-parts";
import {
  planPower,
  shiftKeys,
} from "./netlist-power";

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

  // 1. Drivers for inductive loads (motor, pump, solenoid, bare relay coil): a MOSFET switch
  //    for a load that only switches on/off, an H-bridge for a motor (owner, 2026-10-18).
  const ents = () => entriesOf(out, getPart);
  {
    const free = ents().filter((e) => isDriver(e.p));
    const needs: LibraryPart[] = [];
    // On/off loads first, so a matching driver already in the list goes to the load it suits.
    const loads = ents().filter((e) => isInductive(e.p)).sort((a, b) => Number(isOnOffLoad(b.p)) - Number(isOnOffLoad(a.p)));
    for (const load of loads) {
      const i = free.findIndex((d) => driverSuits(d.p, load.p));
      if (i >= 0) free.splice(i, 1);
      else if (free.length) free.shift();
      else needs.push(load.p);
    }
    for (const load of needs) {
      const driver = isOnOffLoad(load)
        ? firstFound(SWITCH_DRIVER_IDS) ?? firstFound(DRIVER_IDS)
        : firstFound(HBRIDGE_DRIVER_IDS) ?? firstFound(DRIVER_IDS);
      if (driver) add(driver, "driver");
    }
  }

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
