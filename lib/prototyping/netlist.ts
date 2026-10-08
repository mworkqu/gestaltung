// The electronics netlist: structure, never pixels.
//
// The model returns components, pins, nets and power rails as JSON. It is
// validated twice before anything is drawn — shape by zod (./netlist-schema),
// references by crossValidate() here — and then checked electrically by our
// own code, not the model's opinion:
//   hardRules()    problems that make the circuit unsafe to build (an inductive
//                  load switched straight from a board pin, an LED without a
//                  resistor, two supplies on one net, a rail over its budget).
//                  Any one of them blocks readiness (audit #1).
//   sanityChecks() everything the diagrams outline: the hard rules' supply
//                  problems plus floating nets and unpowered parts.
// Our rules (./electronics-rules) then add the drivers, diodes and resistors
// INTO the netlist, and the augmented netlist is what is stored — so both
// diagrams (./wiring-svg, ./schematic-svg) and the bill of materials come from
// one model.
//
// Pure and client-safe.

import { humanName } from "./human-name";

export const PIN_TYPES = [
  "power_in",
  "power_out",
  "ground",
  "input",
  "output",
  "bidirectional",
  "passive",
] as const;
export type PinType = (typeof PIN_TYPES)[number];

export type Pin = { id: string; name: string; type: PinType };
/**
 * What our rules know about a component from its BOM line (set when the
 * netlist is augmented; absent on the model's raw netlist, where the function
 * text decides). "other" means the line says it is neither.
 */
export type ComponentRole = "inductive_load" | "driver" | "other";
export type NetComponent = {
  ref: string;
  function: string;
  bomId: string;
  pins: Pin[];
  /** Typical draw in mA, as proposed by the model; used only for the supply checks. */
  currentMa?: number | null;
  role?: ComponentRole;
};
export type Connection = { ref: string; pin: string };
export type Net = { name: string; connections: Connection[] };
export type PowerRail = { name: string; sourceRef: string; maxCurrentMa: number };

export type Netlist = {
  components: NetComponent[];
  nets: Net[];
  powerRails: PowerRail[];
  notes: string[];
};

/** projects.netlist (migration 0023). */
export type ProjectNetlist = Netlist & { generatedAt: string; model: string | null };

/**
 * Every reference must point at something that exists. Returns plain English
 * problems (they are also fed back to the model on the one retry); empty
 * means valid. `bomIds` are the model's lines plus, for an augmented netlist,
 * the rule lines its added components point at.
 */
export function crossValidate(n: Netlist, bomIds: string[]): string[] {
  const errs: string[] = [];
  const bom = new Set(bomIds);
  const refs = new Map<string, NetComponent>();
  for (const c of n.components) {
    if (refs.has(c.ref)) errs.push(`component ref ${c.ref} is used twice`);
    refs.set(c.ref, c);
    if (!bom.has(c.bomId)) errs.push(`component ${c.ref} has bomId "${c.bomId}", which is not a BOM line id`);
    const pins = new Set<string>();
    for (const p of c.pins) {
      if (pins.has(p.id)) errs.push(`component ${c.ref} has pin id ${p.id} twice`);
      pins.add(p.id);
    }
  }
  const netNames = new Set<string>();
  const pinNet = new Map<string, string>();
  for (const net of n.nets) {
    if (netNames.has(net.name)) errs.push(`net name ${net.name} is used twice`);
    netNames.add(net.name);
    for (const { ref, pin } of net.connections) {
      const c = refs.get(ref);
      if (!c) {
        errs.push(`net ${net.name} connects ${ref}.${pin}, but there is no component ${ref}`);
        continue;
      }
      if (!c.pins.some((p) => p.id === pin)) {
        errs.push(`net ${net.name} connects ${ref}.${pin}, but ${ref} has no pin ${pin}`);
        continue;
      }
      const key = `${ref}.${pin}`;
      const other = pinNet.get(key);
      if (other && other !== net.name) errs.push(`pin ${key} is on two nets (${other} and ${net.name})`);
      pinNet.set(key, net.name);
    }
  }
  for (const r of n.powerRails) {
    if (!refs.has(r.sourceRef)) errs.push(`power rail ${r.name} has sourceRef ${r.sourceRef}, which is not a component`);
  }
  return errs;
}

// ── What a component is ─────────────────────────────────────────────────────

export type SymbolKind = "resistor" | "capacitor" | "led" | "diode" | "transistor" | "connector" | "motor" | "ic";

/** Which schematic symbol a component gets — and what our rules take it for. */
export function symbolKind(c: NetComponent): SymbolKind {
  // The designator is the most reliable signal, so it decides first. Our
  // rules name their parts R_LED1, R_B1, Q1, D1.
  const ref = c.ref.toUpperCase();
  if (/^LED\d/.test(ref)) return "led";
  if (/^R(_[A-Z]+)?\d/.test(ref)) return "resistor";
  if (/^C\d/.test(ref)) return "capacitor";
  if (/^D(_[A-Z]+)?\d/.test(ref)) return "diode";
  if (/^Q(_[A-Z]+)?\d/.test(ref)) return "transistor";
  if (/^M\d/.test(ref)) return "motor";
  if (/^(J|BT|P)\d/.test(ref)) return "connector";
  if (/^U\d/.test(ref)) return "ic";
  // Otherwise the function, most specific words first ("LED resistor" is a resistor).
  const t = c.function.toLowerCase();
  if (/resist/.test(t)) return "resistor";
  if (/capacit/.test(t)) return "capacitor";
  if (/\bled\b|light.emitting/.test(t)) return "led";
  if (/diode/.test(t)) return "diode";
  if (/transistor|mosfet|\bbjt\b/.test(t)) return "transistor";
  if (/motor|servo|\bfan\b|pump/.test(t)) return "motor";
  if (/connector|header|terminal|jack|plug|socket|battery|cell|panel/.test(t)) return "connector";
  return "ic";
}

// The model writes `function` in the project's language, so both are read.
const INDUCTIVE_EN = /\b(motors?|pumps?|solenoids?|relays?|fans?)\b/i;
const INDUCTIVE_AR = /مضخ|محرك|مروح|مرحل|ريليه|ريلاي|ملف لولبي|صمام/;
const NOT_INDUCTIVE_EN = /servo|stepper|\bmodule\b|driver|\bboard\b|\bshield\b|h.?bridge/i;
const NOT_INDUCTIVE_AR = /سيرفو|سرفو|مؤازر|خطوي|ستيبر|وحدة|موديول|مشغل|درايفر/;
const DRIVER_EN = /transistor|mosfet|\bbjt\b|driver|h.?bridge|darlington|relay module/i;
const DRIVER_AR = /ترانزستور|موسفت|درايفر|مشغل/;

/**
 * A motor, pump, solenoid, relay coil or fan: it needs a driver and a flyback
 * diode. Servos and steppers (driven through their own electronics) and
 * modules that carry a driver are not.
 */
export function isInductiveLoad(c: NetComponent): boolean {
  if (c.role) return c.role === "inductive_load";
  const f = c.function;
  return (INDUCTIVE_EN.test(f) || INDUCTIVE_AR.test(f)) && !NOT_INDUCTIVE_EN.test(f) && !NOT_INDUCTIVE_AR.test(f);
}

/** A transistor, MOSFET or driver module: what may switch an inductive load. */
export function isDriver(c: NetComponent): boolean {
  if (c.role) return c.role === "driver";
  return symbolKind(c) === "transistor" || DRIVER_EN.test(c.function) || DRIVER_AR.test(c.function);
}

// ── Nets ────────────────────────────────────────────────────────────────────

const GROUND_NAME = /^(gnd|ground|0v|vss|agnd|dgnd)$/i;

/** Net names that carry power: every rail, plus any net a power_out pin drives. */
export function powerNets(n: Netlist): { power: Set<string>; ground: Set<string> } {
  const typeOf = pinTypes(n);
  const power = new Set<string>();
  const ground = new Set<string>();
  const rails = new Set(n.powerRails.map((r) => r.name.toLowerCase()));
  for (const net of n.nets) {
    const types = net.connections.map((c) => typeOf.get(`${c.ref}.${c.pin}`));
    if (GROUND_NAME.test(net.name) || types.includes("ground")) ground.add(net.name);
    else if (rails.has(net.name.toLowerCase()) || types.includes("power_out")) power.add(net.name);
  }
  return { power, ground };
}

function pinTypes(n: Netlist) {
  const m = new Map<string, PinType>();
  for (const c of n.components) for (const p of c.pins) m.set(`${c.ref}.${p.id}`, p.type);
  return m;
}

/**
 * Where a component is driven straight from a controller's pin: each of its
 * pins that shares a signal net with an output (or bidirectional) pin of a
 * component that is not a driver.
 */
export function gpioDrives(n: Netlist, c: NetComponent): { pin: string; net: string; controller: string }[] {
  const typeOf = pinTypes(n);
  const { power, ground } = powerNets(n);
  const byRef = new Map(n.components.map((k) => [k.ref, k]));
  const out: { pin: string; net: string; controller: string }[] = [];
  for (const net of n.nets) {
    if (power.has(net.name) || ground.has(net.name)) continue;
    const mine = net.connections.find((k) => k.ref === c.ref);
    if (!mine) continue;
    const ctl = net.connections.find((k) => {
      if (k.ref === c.ref) return false;
      const t = typeOf.get(`${k.ref}.${k.pin}`);
      const other = byRef.get(k.ref);
      return (t === "output" || t === "bidirectional") && !!other && !isDriver(other);
    });
    if (ctl) out.push({ pin: mine.pin, net: net.name, controller: ctl.ref });
  }
  return out;
}

/**
 * An LED with no resistor in series. Only its signal-side nets count: a
 * resistor elsewhere on the ground or supply net (a divider, a pull-up) is not
 * in the LED's current path.
 */
export function lacksResistor(n: Netlist, c: NetComponent): boolean {
  const byRef = new Map(n.components.map((k) => [k.ref, k]));
  const { power, ground } = powerNets(n);
  return !n.nets.some(
    (net) =>
      !power.has(net.name) &&
      !ground.has(net.name) &&
      net.connections.some((k) => k.ref === c.ref) &&
      net.connections.some((k) => k.ref !== c.ref && byRef.has(k.ref) && symbolKind(byRef.get(k.ref)!) === "resistor")
  );
}

/** Every BOM line id the circuit's components point at. */
export const circuitBomIds = (n: Netlist | null | undefined) => new Set((n?.components ?? []).map((c) => c.bomId));

/**
 * The model's supply conflicts, in words for its one retry: which power_out
 * pins share a net, and how to wire it instead.
 */
export function supplyConflictErrors(n: Netlist): string[] {
  const typeOf = pinTypes(n);
  return hardRules(n).flatMap((f) => {
    if (f.code !== "shorted_supplies") return [];
    const pins = (n.nets.find((x) => x.name === f.net)?.connections ?? [])
      .filter((k) => typeOf.get(`${k.ref}.${k.pin}`) === "power_out")
      .map((k) => `${k.ref}.${k.pin}`);
    return [
      `net ${f.net} has power_out pins on ${pins.join(" and ")} — only one supply may drive a net; a board fed from a supply takes it on a power_in pin`,
    ];
  });
}

// ── Power budget ────────────────────────────────────────────────────────────

/** Assumed draw of an inductive load whose current nobody stated, in mA. */
export const DEFAULT_LOAD_MA = 200;

export type RailBudget = {
  rail: string;
  sourceRef: string;
  maxMa: number;
  /**
   * Every component on the rail other than its source; ma null = not stated.
   * `assumed`: an inductive load with no stated current, counted at
   * DEFAULT_LOAD_MA — the same figure its driver is sized for.
   */
  loads: { ref: string; ma: number | null; assumed?: boolean }[];
  drawMa: number;
  /** maxMa − drawMa; negative = over budget. */
  headroomMa: number;
};

/** Per declared rail: its source, what hangs on it, and what is left. */
export function powerBudget(n: Netlist): RailBudget[] {
  return n.powerRails.map((rail) => {
    const net = n.nets.find((x) => x.name.toLowerCase() === rail.name.toLowerCase());
    const refs = net ? [...new Set(net.connections.map((x) => x.ref))].filter((r) => r !== rail.sourceRef) : [];
    const loads = refs.flatMap((ref) => {
      const c = n.components.find((k) => k.ref === ref);
      const ma = c?.currentMa;
      const stated = typeof ma === "number" && Number.isFinite(ma) ? ma : null;
      if (c && isInductiveLoad(c) && !(stated && stated > 0)) return [{ ref, ma: DEFAULT_LOAD_MA, assumed: true }];
      // A pull-up or a flyback diode on the rail is not a load.
      if (c && !stated && c.pins.every((p) => p.type === "passive") && symbolKind(c) !== "motor") return [];
      return [{ ref, ma: stated }];
    });
    const drawMa = loads.reduce((s, l) => s + (l.ma ?? 0), 0);
    return { rail: rail.name, sourceRef: rail.sourceRef, maxMa: rail.maxCurrentMa, loads, drawMa, headroomMa: rail.maxCurrentMa - drawMa };
  });
}

// ── Hard rules (audit #1): any one blocks readiness ─────────────────────────

export type HardFlag =
  | { code: "inductive_on_gpio"; ref: string; net: string; controller: string }
  | { code: "led_no_resistor"; ref: string }
  | { code: "shorted_supplies"; net: string; refs: string[] }
  | { code: "power_budget"; rail: string; drawMa: number; maxMa: number; refs: string[] };

/** The one key a hard flag is known by: `circuit:<code>:<ref>`. */
export const hardFlagId = (f: HardFlag) =>
  `circuit:${f.code}:${f.code === "shorted_supplies" ? f.net : f.code === "power_budget" ? f.rail : f.ref}`;

export function hardRules(n: Netlist): HardFlag[] {
  const flags: HardFlag[] = [];
  const typeOf = pinTypes(n);

  // An inductive load switched straight from a board pin: the pin cannot
  // carry the current, and the coil's kick-back destroys it.
  for (const c of n.components.filter(isInductiveLoad)) {
    for (const d of gpioDrives(n, c)) flags.push({ code: "inductive_on_gpio", ref: c.ref, net: d.net, controller: d.controller });
  }

  // An LED with nothing limiting its current.
  for (const c of n.components.filter((c) => symbolKind(c) === "led")) {
    if (lacksResistor(n, c)) flags.push({ code: "led_no_resistor", ref: c.ref });
  }

  // Two supplies driving one net.
  for (const net of n.nets) {
    const drivers = [
      ...new Set(net.connections.filter((x) => typeOf.get(`${x.ref}.${x.pin}`) === "power_out").map((x) => x.ref)),
    ];
    if (drivers.length > 1) flags.push({ code: "shorted_supplies", net: net.name, refs: drivers });
  }

  // Loads on a rail drawing more than its source declares.
  for (const b of powerBudget(n)) {
    if (b.drawMa > b.maxMa)
      flags.push({ code: "power_budget", rail: b.rail, drawMa: b.drawMa, maxMa: b.maxMa, refs: b.loads.map((l) => l.ref) });
  }
  return flags;
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** A hard flag in words (Prototyping.hard_*), naming each part by ref and function. */
export function describeHard(f: HardFlag, n: Netlist, t: T): string {
  const who = (ref: string) => {
    const c = n.components.find((x) => x.ref === ref);
    return c ? `${ref} (${humanName(c.function, c.bomId)})` : ref;
  };
  switch (f.code) {
    case "inductive_on_gpio":
      return t("hard_inductive_on_gpio", { ref: who(f.ref), net: f.net });
    case "led_no_resistor":
      return t("hard_led_no_resistor", { ref: who(f.ref) });
    case "shorted_supplies":
      return t("hard_shorted_supplies", { net: f.net, refs: f.refs.map(who).join(", ") });
    case "power_budget":
      return t("hard_power_budget", { rail: f.rail, draw: f.drawMa, max: f.maxMa });
  }
}

// ── Electrical sanity checks (outlined on the diagrams) ─────────────────────

export type SanityFlag =
  | { code: "floating"; net: string; ref: string | null }
  | { code: "unpowered"; ref: string }
  | { code: "shorted"; net: string; refs: string[] }
  | { code: "overcurrent"; rail: string; drawMa: number; maxMa: number; refs: string[] };

/** Anything a diagram outlines in red. */
export type Flag = SanityFlag | HardFlag;

export function sanityChecks(n: Netlist): SanityFlag[] {
  const flags: SanityFlag[] = [];
  const { power } = powerNets(n);

  // Floating: a net that goes nowhere.
  for (const net of n.nets) {
    if (net.connections.length < 2)
      flags.push({ code: "floating", net: net.name, ref: net.connections[0]?.ref ?? null });
  }

  // No power connection. Purely passive parts (resistors, capacitors) and the
  // rail sources themselves are exempt.
  const sources = new Set(n.powerRails.map((r) => r.sourceRef));
  for (const c of n.components) {
    if (sources.has(c.ref) || c.pins.every((p) => p.type === "passive")) continue;
    const powered = n.nets.some((net) => power.has(net.name) && net.connections.some((x) => x.ref === c.ref));
    if (!powered) flags.push({ code: "unpowered", ref: c.ref });
  }

  // Supply conflicts and budgets: the hard rules are the one source.
  for (const h of hardRules(n)) {
    if (h.code === "shorted_supplies") flags.push({ code: "shorted", net: h.net, refs: h.refs });
    else if (h.code === "power_budget")
      flags.push({ code: "overcurrent", rail: h.rail, drawMa: h.drawMa, maxMa: h.maxMa, refs: h.refs });
  }
  return flags;
}

/** Refs a flag is about, for outlining them on the diagrams. */
export const flaggedRefs = (flags: Flag[]) =>
  new Set(
    flags.flatMap((f) => {
      switch (f.code) {
        case "unpowered":
        case "inductive_on_gpio":
        case "led_no_resistor":
          return [f.ref];
        case "floating":
          return f.ref ? [f.ref] : [];
        default:
          return f.refs;
      }
    })
  );

/** XML-escape text for SVG output. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
