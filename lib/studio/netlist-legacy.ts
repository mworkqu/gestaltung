// Studio wiring, stage 4: toLegacyNetlist() (the lib/prototyping/netlist.ts
// shape the rule engine and firmware generator read) and buildWiring(), the one
// call the API and UI use. Import from ./netlist.
//
// Pure and client-safe.

import type {
  Netlist as LegacyNetlist,
  NetComponent,
  PinType,
  PowerRail,
  ComponentRole,
} from "@/lib/prototyping/netlist";
import type { LibraryPart, Net, ProductSpec, StudioCheck, StudioComponent } from "./schema";
import { studioChecks } from "./plain-checks";
import { servoPlan } from "./servo-plan";
import {
  type GetPart,
  type Locale,
  chargerPins,
  entriesOf,
  isBattery,
  isCharger,
  isConverter,
  isDriver,
  isInductive,
  isMcu,
  isPowerRole,
  isPowerSource,
  isServoDriver,
  isSignalRole,
  ref,
  servoChannelOf,
  servoSupplyRail,
  splitRef,
  symbolKind,
} from "./netlist-parts";
import {
  ADDED_REASON,
  type AddedComponent,
  resolveRequired,
} from "./netlist-required";
import { buildNetlist } from "./netlist-build";

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
  // Servos on a driver fed by a wall supply (Part E): the supply board drives the 5 V
  // rail (the board takes its power from it), declared as a rail of supplyMA.
  const sp = servoPlan(components, {}, getPart);
  const supplyRail = servoSupplyRail(sp, entries);
  if (supplyRail) supplyRefs.add(supplyRail.ref);
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
      else if (supplyRail?.ref === r) type = "power_out";
      else if (isServoDriver(e.p) && x.role === "5v" && servoChannelOf(x.id) !== null) type = "power_out"; // feeds its servo
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
  if (supplyRail) {
    const net = netOf.get(supplyRail.ref);
    if (net && !rails.some((x) => x.name === net)) rails.push({ name: net, sourceRef: supplyRail.inst, maxCurrentMa: supplyRail.maxMa });
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
