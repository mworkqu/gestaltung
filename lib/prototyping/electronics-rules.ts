// Our rules for the electronics bill of materials — not the model's.
//
// Walking the validated netlist, they add what a real build needs and a model
// is unreliable at, each with the reason it exists:
//   * a current-limiting resistor in series with every LED without one
//   * a driver for every inductive load (DC motor, pump, solenoid, relay coil,
//     fan) switched straight from a board pin: an NPN transistor as a low-side
//     switch, its base resistor, and a flyback diode across the load
//   * a flyback diode across an inductive load already switched on its low side
//   * a pull-up on every I2C line and every button signal without one
//   * a decoupling capacitor on every bare IC power pin
//   * a logic level shifter where a 5 V output drives a 3.3 V input, and a
//     warning in words where 3.3 V drives 5 V (it may or may not read reliably)
// plus the build consumables of the chosen route only (Prototype: breadboard
// and jumper wires; Custom PCB: perfboard, hookup wire and heat-shrink for the
// soldered prototype), a USB cable per board, power, and, on the Custom PCB
// route, the board-fabrication line.
//
// ONE model (audit #1): every part a rule adds to the circuit is inserted
// INTO the netlist as a component (R_LED1, Q1, R_B1, D1, R_PU1, C1) whose
// bomId is the id of the BOM line that buys it, and that line lists the refs
// it covers. The augmented netlist is what gets stored, so the schematic, the
// wiring diagram and the bill of materials all show the same circuit.
//
// Identical lines are merged: four LEDs give ONE line of four resistors,
// with every LED named in its reason and every resistor in `refs`. Line ids
// are stable, so a line the client removed (bom.dismissed) is never added
// back. Values are orderable: "330 Ω, 1/4 W, ±5 %, through-hole", chosen from
// the E12 series. The level shifter stays a line only: where it goes depends
// on the board's pin-out.
//
// Pure. Text comes through the injected `t`, so lines read in either language.

import type { BuildRoute } from "./analysis";
import type { ProjectLine } from "./bom";
import {
  DEFAULT_LOAD_MA,
  crossValidate,
  gpioDrives,
  isInductiveLoad,
  lacksResistor,
  powerNets,
  symbolKind,
  type ComponentRole,
  type NetComponent,
  type Netlist,
  type Pin,
} from "./netlist";
import { CLASSES, formatValue, type AttrClass } from "@/lib/store/attributes";

type T = (key: string, params?: Record<string, string | number>) => string;

export type LevelFlag = {
  net: string;
  direction: "high_to_low" | "low_to_high";
  drivers: string[];
  receivers: string[];
};

/** A rule line, with the netlist refs it buys (bomId of each is this line's id). */
export type RuleLine = ProjectLine & { refs?: string[] };

const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** Smallest standard E12 value at or above r. */
export function nextE12(r: number): number {
  if (!(r > 0)) return 10;
  const exp = Math.floor(Math.log10(r));
  for (const e of [exp, exp + 1])
    for (const m of E12) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= r - 1e-9) return v;
    }
  return 10 ** (exp + 1);
}

/** "5V" → 5, "3V3" → 3.3, "3.3V" → 3.3, "7V4" → 7.4; null when the name says no voltage. */
export function parseVolts(name: string): number | null {
  const m = name.trim().match(/^\+?(\d+)(?:[vV.,](\d+))?\s*[vV]?$/);
  if (!m) return null;
  const v = Number(`${m[1]}.${m[2] ?? 0}`);
  return Number.isFinite(v) && v > 0 && v < 60 ? v : null;
}

// What a board family runs its IO at. Used when the line doesn't state
// logic_v, so an ESP32's LED resistor is sized for 3.3 V, not the 5 V rail
// that feeds the board.
const PLATFORM_LOGIC_V: Record<string, number> = {
  esp32: 3.3,
  esp8266: 3.3,
  raspberry_pi: 3.3,
  raspberry_pi_pico: 3.3,
  stm32: 3.3,
  arduino_uno: 5,
  arduino_nano: 5,
  arduino_mega: 5,
};

const LED_VF: Record<string, number> = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.0, white: 3.0 };
const LED_MA = 10;

/** Actuator types that are a coil: they need a driver and a flyback diode. */
const INDUCTIVE_TYPES = ["dc_motor", "pump", "solenoid", "fan", "vibration"];
/** Base-emitter drop of a small NPN in saturation. */
const VBE = 0.7;
/** Most base current we ask of a board pin, in mA. */
const GPIO_MAX_MA = 10;
/** Above this a small TO-92 NPN is the wrong part; we say so. */
const HEAVY_LOAD_MA = 500;

/**
 * The build consumables of each route: [id, consumable_type, size, critical].
 * One route's set only — a breadboard build and a soldered build never share
 * a bill of materials.
 */
export const BUILD_CONSUMABLES: Record<BuildRoute, readonly (readonly [string, string, string, boolean])[]> = {
  prototype: [
    ["breadboard", "breadboard", "830", true],
    ["jumpers", "jumper_wires", "M-M/M-F/F-F", true],
  ],
  custom_pcb: [
    ["perfboard", "perfboard", "", true],
    ["hookup_wire", "hookup_wire", "22 AWG", true],
    ["heat_shrink", "heat_shrink", "assortment", false],
  ],
};

const passive = (...ids: string[]): Pin[] => ids.map((id) => ({ id, name: id, type: "passive" as const }));

/** What a component's BOM line says it is; undefined lets the function text decide. */
function roleFromLine(l: ProjectLine | undefined): ComponentRole | undefined {
  if (!l) return undefined;
  const a = l.attributes ?? {};
  if (l.class === "actuator") {
    const type = String(a.actuator_type ?? "");
    if (!type) return undefined;
    return INDUCTIVE_TYPES.includes(type) ? "inductive_load" : "other";
  }
  if (l.class === "module")
    return ["motor_driver", "relay"].includes(String(a.module_type ?? "")) ? "driver" : "other";
  // A switch-class line may still be a bare relay: its text decides.
  if (["board", "sensor", "led", "header", "power"].includes(String(l.class ?? ""))) return "other";
  return undefined;
}

type Ctx = {
  netlist: Netlist | null;
  /** The model's electronics lines (boards, modules, sensors, actuators). */
  lines: ProjectLine[];
  route: BuildRoute;
  /** The spec's power fact: mains | battery | solar | null. */
  power: string | null;
  t: T;
};

export type RulesResult = {
  lines: RuleLine[];
  /** The model's netlist with every rule-added part inserted; null when there was none. */
  netlist: Netlist | null;
  levelFlags: LevelFlag[];
  assumptions: string[];
};

/**
 * Derive the rule lines and the augmented netlist. The input MUST be the
 * model's raw netlist, never a stored (already augmented) one: the checks for
 * LED resistors, drivers, pull-ups and diodes see our own parts and skip, but
 * decoupling capacitors do not — re-deriving would add a second one per pin.
 */
export function deriveElectronics({ netlist: model, lines, route, power, t }: Ctx): RulesResult {
  const out = new Map<string, RuleLine>();
  const reasons = new Map<string, string[]>();
  const covered = new Map<string, string[]>();
  const assumptions: string[] = [];
  const lineOf = (c: NetComponent) => lines.find((l) => l.id === c.bomId);

  const add = (
    id: string,
    cls: AttrClass,
    attributes: Record<string, unknown>,
    fn: string,
    spec: string,
    qty: number,
    reason: string,
    opts: { extra?: Partial<ProjectLine>; ref?: string } = {}
  ) => {
    const prev = out.get(id);
    if (prev) prev.quantity += qty;
    else
      out.set(id, {
        id,
        function: fn,
        spec,
        quantity: qty,
        kind: "electronics",
        critical: true,
        class: cls,
        attributes: { class: cls, ...attributes },
        group: CLASSES[cls].group,
        origin: "rule",
        ...opts.extra,
      });
    reasons.set(id, [...(reasons.get(id) ?? []), reason]);
    if (opts.ref) covered.set(id, [...(covered.get(id) ?? []), opts.ref]);
  };

  const levelFlags: LevelFlag[] = [];
  // Our copy: the model's netlist is never mutated.
  const n: Netlist | null = model ? structuredClone(model) : null;

  if (n) {
    for (const c of n.components) {
      const role = roleFromLine(lineOf(c));
      if (role) c.role = role;
    }

    const { power: powerSet, ground } = powerNets(n);
    const byRef = (ref: string) => n.components.find((c) => c.ref === ref);
    const netsOf = (ref: string) => n.nets.filter((x) => x.connections.some((c) => c.ref === ref));
    const netOfPin = (ref: string, pin: string) =>
      n.nets.find((x) => x.connections.some((k) => k.ref === ref && k.pin === pin))?.name ?? null;
    const hasResistor = (netName: string) =>
      n.nets
        .find((x) => x.name === netName)
        ?.connections.some((c) => {
          const k = byRef(c.ref);
          return k ? symbolKind(k) === "resistor" : false;
        }) ?? false;

    // Editing the circuit.
    const nextRef = (prefix: string) => {
      let i = 1;
      while (byRef(`${prefix}${i}`)) i++;
      return `${prefix}${i}`;
    };
    const freeNet = (base: string) => {
      let name = base.slice(0, 24);
      for (let i = 2; n.nets.some((x) => x.name === name); i++) name = `${base.slice(0, 20)}_${i}`;
      return name;
    };
    const detach = (ref: string, pin: string) => {
      for (const x of n.nets) x.connections = x.connections.filter((k) => !(k.ref === ref && k.pin === pin));
    };
    const attach = (net: string, ref: string, pin: string) => {
      const x = n.nets.find((k) => k.name === net);
      if (x) x.connections.push({ ref, pin });
      else n.nets.push({ name: net, connections: [{ ref, pin }] });
    };
    const place = (c: NetComponent) => n.components.push({ currentMa: 0, ...c });
    const gndNet = () => [...ground][0] ?? "GND";
    const resistorPart = (ref: string, r: number): NetComponent => ({
      ref,
      function: `${t("rule_resistorName")} ${formatValue(r, "Ω")}`,
      bomId: `rule_res_${r}`,
      pins: passive("1", "2"),
    });
    const resistorLine = (r: number, reason: string, ref?: string) =>
      add(
        `rule_res_${r}`,
        "resistor",
        { resistance_ohm: r, tolerance_pct: 5, power_w: 0.25, package: "through_hole" },
        t("rule_resistorName"),
        t("rule_resistorSpec", { value: formatValue(r, "Ω") }),
        1,
        reason,
        { ref }
      );

    // A component's logic voltage: its line's logic_v, else the rail its
    // supply pin sits on.
    const logicV = (c: NetComponent): number | null => {
      const l = lineOf(c);
      const lv = Number(l?.attributes?.logic_v);
      if (lv > 0) return lv;
      const platform = PLATFORM_LOGIC_V[String(l?.attributes?.platform ?? "")];
      if (platform) return platform;
      for (const p of c.pins.filter((p) => p.type === "power_in")) {
        const net = netOfPin(c.ref, p.id);
        const v = net ? parseVolts(net) : null;
        if (v) return v;
      }
      return null;
    };
    const boardV =
      n.components.map((c) => (lineOf(c)?.class === "board" ? logicV(c) : null)).find((v) => v) ?? null;
    /** The supply net at a voltage, if the circuit has one. */
    const railAt = (v: number | null) =>
      v ? [...powerSet].find((name) => Math.abs((parseVolts(name) ?? 0) - v) < 0.05 * v) ?? null : null;

    // LEDs: one current-limiting resistor each, in series on the drive side.
    for (const c of n.components.filter((c) => symbolKind(c) === "led")) {
      if (!lacksResistor(n, c)) continue;
      const nets = netsOf(c.ref);
      let v: number | null = null;
      for (const x of nets) {
        if (powerSet.has(x.name)) v = Math.max(v ?? 0, parseVolts(x.name) ?? 0) || v;
        else if (!ground.has(x.name))
          for (const k of x.connections)
            if (k.ref !== c.ref) {
              const other = byRef(k.ref);
              const kv = other ? logicV(other) : null;
              if (kv) v = Math.max(v ?? 0, kv);
            }
      }
      if (!v) {
        v = boardV ?? 5;
        assumptions.push(t("rule_assumedDrive", { ref: c.ref, v }));
      }
      const color = String(lineOf(c)?.attributes?.color ?? "red");
      const vf = LED_VF[color] ?? 2.0;
      if (v <= vf) {
        assumptions.push(t("rule_ledTooLow", { ref: c.ref, v, vf }));
        continue;
      }
      const r = nextE12((v - vf) / (LED_MA / 1000));
      // The drive side: the board pin's net, else the supply side; never ground.
      const sides = nets.filter((x) => !ground.has(x.name));
      const side = sides.find((x) => !powerSet.has(x.name)) ?? sides[0];
      let ref: string | undefined;
      if (side) {
        const pin = side.connections.find((k) => k.ref === c.ref)!.pin;
        ref = nextRef("R_LED");
        const between = freeNet(`${c.ref}_${pin}`);
        detach(c.ref, pin);
        attach(side.name, ref, "1");
        attach(between, ref, "2");
        attach(between, c.ref, pin);
        place(resistorPart(ref, r));
      }
      resistorLine(r, t("rule_ledReason", { ref: c.ref, v, ma: LED_MA }), ref);
    }

    // Pull-ups: from the signal to the logic supply, when the circuit has it.
    const pullUp = (net: string, r: number, reason: string, v: number | null) => {
      const rail = railAt(v ?? boardV);
      let ref: string | undefined;
      if (rail) {
        ref = nextRef("R_PU");
        attach(net, ref, "1");
        attach(rail, ref, "2");
        place(resistorPart(ref, r));
      }
      resistorLine(r, reason, ref);
    };
    const netLogicV = (net: string) =>
      n.nets
        .find((x) => x.name === net)
        ?.connections.map((k) => byRef(k.ref))
        .filter((c): c is NetComponent => !!c && lineOf(c)?.class === "board")
        .map(logicV)
        .find((v) => v) ?? null;

    // I2C: a pull-up on each SDA / SCL line that has none.
    for (const x of [...n.nets]) {
      const isI2C =
        /\b(sda|scl)\b/i.test(x.name.replace(/_/g, " ")) ||
        x.connections.some((k) => /^(sda|scl)$/i.test(byRef(k.ref)?.pins.find((p) => p.id === k.pin)?.name ?? ""));
      if (!isI2C || hasResistor(x.name) || powerSet.has(x.name) || ground.has(x.name)) continue;
      pullUp(x.name, 4700, t("rule_i2cReason", { net: x.name }), netLogicV(x.name));
    }

    // Buttons: a pull-up on each switch signal that has none.
    for (const c of n.components.filter(
      (c) => /^SW\d/i.test(c.ref) || lineOf(c)?.class === "switch" || /\b(button|push ?button)\b/i.test(c.function)
    )) {
      for (const x of netsOf(c.ref)) {
        if (powerSet.has(x.name) || ground.has(x.name) || hasResistor(x.name)) continue;
        pullUp(x.name, 10000, t("rule_buttonReason", { ref: c.ref, net: x.name }), netLogicV(x.name));
      }
    }

    // Bare ICs: a 100 nF decoupling capacitor per supply pin, to ground.
    // Boards and modules already carry their own.
    for (const c of n.components.filter((c) => lineOf(c)?.class === "ic")) {
      for (const p of c.pins.filter((p) => p.type === "power_in")) {
        const net = netOfPin(c.ref, p.id);
        let ref: string | undefined;
        if (net) {
          ref = nextRef("C");
          attach(net, ref, "1");
          attach(gndNet(), ref, "2");
          place({ ref, function: `${t("rule_capName")} ${formatValue(1e-7, "F")}`, bomId: "rule_cap_100n", pins: passive("1", "2") });
        }
        add(
          "rule_cap_100n",
          "capacitor",
          { capacitance_f: 1e-7, voltage_v: 50, dielectric: "ceramic", package: "through_hole" },
          t("rule_capName"),
          t("rule_capSpec", { value: formatValue(1e-7, "F") }),
          1,
          t("rule_decouplingReason", { ref: c.ref, pin: p.name }),
          { ref }
        );
      }
    }

    // Inductive loads.
    const flyback = (load: NetComponent, low: string, high: string | null, ma: number) => {
      const amps = Math.max(1, Math.ceil(ma / 1000));
      const id = amps === 1 ? "rule_diode_flyback" : `rule_diode_flyback_${amps}a`;
      // Anode on the switched (low) side, cathode on the supply.
      const ref = nextRef("D");
      attach(low, ref, "A");
      if (high) attach(high, ref, "K");
      place({ ref, function: t("rule_diodeName"), bomId: id, pins: passive("A", "K") });
      add(
        id,
        "diode",
        { diode_type: "rectifier", current_a: amps, voltage_v: 400, package: "through_hole" },
        t("rule_diodeName"),
        amps === 1 ? t("rule_diodeSpec") : t("rule_diodeSpecA", { a: amps }),
        1,
        t("rule_flybackReason", { ref: load.ref }),
        { ref }
      );
    };
    const diodeAcross = (c: NetComponent) => {
      const mine = netsOf(c.ref).map((x) => x.name);
      return (
        mine.length >= 2 &&
        n.components.some(
          (d) => symbolKind(d) === "diode" && netsOf(d.ref).filter((x) => mine.includes(x.name)).length >= 2
        )
      );
    };

    for (const c of n.components.filter(isInductiveLoad)) {
      const l = lineOf(c);
      const hasDiode = diodeAcross(c);
      const drives = gpioDrives(n, c);
      const statedMa =
        c.currentMa && c.currentMa > 0
          ? c.currentMa
          : Number(l?.attributes?.current_a) > 0
            ? Number(l?.attributes?.current_a) * 1000
            : null;
      const ma = statedMa ?? DEFAULT_LOAD_MA;

      if (drives.length) {
        // Switched straight from a board pin: a low-side NPN switch.
        //   pin → R_B → base; emitter → GND; collector → load low side;
        //   load high side → its supply rail; flyback diode across the load.
        if (!statedMa) assumptions.push(t("rule_assumedLoad", { ref: c.ref, ma }));
        if (ma > HEAVY_LOAD_MA) assumptions.push(t("rule_driverHeavy", { ref: c.ref, ma }));
        const d = drives[0];
        const controller = byRef(d.controller);
        const vGpio = (controller && logicV(controller)) || boardV || 3.3;
        const ibMa = Math.min(ma / 10, GPIO_MAX_MA);
        const rb = nextE12((vGpio - VBE) / (ibMa / 1000));

        const wantV = Number(l?.attributes?.voltage_v) || null;
        const supply =
          railAt(wantV) ??
          [...powerSet].sort((a, b) => (parseVolts(b) ?? 0) - (parseVolts(a) ?? 0))[0] ??
          null;
        const railV = (supply ? parseVolts(supply) : null) ?? wantV ?? 5;

        const q = nextRef("Q");
        const baseNet = freeNet(`${q}_B`);
        const lowNet = freeNet(`${q}_C`);
        const others = c.pins
          .filter((p) => p.id !== d.pin)
          .map((p) => ({ pin: p.id, net: netOfPin(c.ref, p.id) }));
        const onSupply = others.find((o) => o.net && powerSet.has(o.net));

        // A moved pin takes the type of where it now sits, so the collector
        // net is never mistaken for ground, nor the supply side for a signal.
        const retype = (pin: string, type: Pin["type"]) => {
          const p = c.pins.find((x) => x.id === pin);
          if (p) p.type = type;
        };
        let high: string | null;
        detach(c.ref, d.pin);
        if (onSupply) {
          // Already fed from a rail: the board pin was its low side.
          attach(lowNet, c.ref, d.pin);
          retype(d.pin, "passive");
          high = onSupply.net;
        } else {
          const low = others.find((o) => o.net && ground.has(o.net)) ?? others[0];
          high = supply ?? `${railV}V`;
          if (low) {
            attach(high, c.ref, d.pin);
            retype(d.pin, "power_in");
            detach(c.ref, low.pin);
            attach(lowNet, c.ref, low.pin);
            retype(low.pin, "passive");
          } else {
            attach(lowNet, c.ref, d.pin);
            retype(d.pin, "passive");
          }
        }

        const rbRef = nextRef("R_B");
        attach(d.net, rbRef, "1");
        attach(baseNet, rbRef, "2");
        attach(baseNet, q, "B");
        attach(lowNet, q, "C");
        attach(gndNet(), q, "E");

        const icMa = Math.max(100, Math.ceil((2 * ma) / 100) * 100);
        const vce = Math.max(10, Math.ceil(2 * railV));
        const npnId = `rule_npn_${icMa}ma_${vce}v`;
        place({ ref: q, function: t("rule_npnName"), bomId: npnId, pins: passive("B", "C", "E"), role: "driver" });
        place(resistorPart(rbRef, rb));
        add(
          npnId,
          "transistor",
          { transistor_type: "npn", current_a: icMa / 1000, voltage_v: vce, package: "to92" },
          t("rule_npnName"),
          t("rule_npnSpec", { ma: icMa, v: vce }),
          1,
          t("rule_driverReason", { ref: c.ref, net: d.net }),
          { ref: q }
        );
        resistorLine(rb, t("rule_baseReason", { q, ref: c.ref }), rbRef);
        if (!hasDiode) flyback(c, lowNet, high, ma);
        continue;
      }

      // Already switched on its low side (by a transistor or a driver): a
      // flyback diode across it. A load between two driver outputs (an
      // H-bridge) gets none — a single diode would short the bridge, and
      // driver modules carry their own. A load straight across a supply is
      // never switched, so it needs none either.
      if (hasDiode) continue;
      const mine = netsOf(c.ref);
      const high = mine.find((x) => powerSet.has(x.name));
      const low = mine.find((x) => x !== high && !ground.has(x.name) && !powerSet.has(x.name));
      if (high && low) flyback(c, low.name, high.name, statedMa ?? DEFAULT_LOAD_MA);
    }

    n.nets = n.nets.filter((x) => x.connections.length > 0);

    // Logic levels across each signal net.
    const shifterNets: string[] = [];
    for (const x of n.nets) {
      if (powerSet.has(x.name) || ground.has(x.name)) continue;
      type End = { ref: string; type: string; v: number | null };
      const ends = x.connections
        .map((k): End | null => {
          const c = byRef(k.ref);
          const pin = c?.pins.find((p) => p.id === k.pin);
          return c && pin ? { ref: c.ref, type: pin.type, v: logicV(c) } : null;
        })
        .filter((e): e is End => e !== null && e.v !== null);
      const drivers = ends.filter((e) => e.type === "output" || e.type === "bidirectional");
      const receivers = ends.filter((e) => e.type === "input" || e.type === "bidirectional");
      const hi = (e: { v: number | null }) => (e.v ?? 0) >= 4.5;
      const lo = (e: { v: number | null }) => (e.v ?? 0) > 0 && (e.v ?? 0) <= 3.6;
      const hiToLo = drivers.some(hi) && receivers.some((r) => lo(r) && drivers.some((d) => hi(d) && d.ref !== r.ref));
      const loToHi = drivers.some(lo) && receivers.some((r) => hi(r) && drivers.some((d) => lo(d) && d.ref !== r.ref));
      if (hiToLo) {
        levelFlags.push({ net: x.name, direction: "high_to_low", drivers: drivers.filter(hi).map((d) => d.ref), receivers: receivers.filter(lo).map((r) => r.ref) });
        shifterNets.push(x.name);
      } else if (loToHi) {
        levelFlags.push({ net: x.name, direction: "low_to_high", drivers: drivers.filter(lo).map((d) => d.ref), receivers: receivers.filter(hi).map((r) => r.ref) });
      }
    }
    if (shifterNets.length) {
      add(
        "rule_level_shifter",
        "module",
        { module_type: "level_shifter", channels: 4 },
        t("rule_shifterName"),
        t("rule_shifterSpec"),
        Math.ceil(shifterNets.length / 4),
        t("rule_shifterReason", { nets: shifterNets.join(", ") })
      );
    }
  }

  // Build consumables: what the prototype cannot be built without — for ONE
  // build route, never both (audit #29). The Prototype route is a breadboard
  // build; the Custom PCB route is still prototyped first, soldered (perfboard,
  // hookup wire, heat-shrink), and the board itself is the fabrication line.
  const c = (id: string, type: string, size: string, critical = true) =>
    add(`rule_${id}`, "consumable", { consumable_type: type, size }, t(`rule_${id}_name`), t(`rule_${id}_spec`), 1, t(`rule_${id}_reason`), { extra: { critical } });
  for (const [id, type, size, critical] of BUILD_CONSUMABLES[route] ?? BUILD_CONSUMABLES.prototype) c(id, type, size, critical);

  const boards = lines.filter((l) => l.class === "board");
  for (const b of boards)
    add("rule_usb_cable", "power", { power_type: "usb_cable" }, t("rule_usb_name"), t("rule_usb_spec"), b.quantity, t("rule_usb_reason", { board: b.function }));

  const hasPowerLine = lines.some((l) => l.class === "power");
  if (!hasPowerLine) {
    const railV = n
      ? Math.max(0, ...n.powerRails.map((r) => parseVolts(r.name) ?? 0))
      : 0;
    if (power === "mains")
      add("rule_adapter", "power", { power_type: "adapter", voltage_v: railV || 5 }, t("rule_adapter_name"), t("rule_adapter_spec", { v: railV || 5 }), 1, t("rule_adapter_reason"));
    else if (power === "battery")
      add("rule_battery_holder", "power", { power_type: "battery_holder" }, t("rule_holder_name"), t("rule_holder_spec"), 1, t("rule_holder_reason"));
  }

  if (route === "custom_pcb") {
    out.set("fab_custom_pcb", {
      id: "fab_custom_pcb",
      function: t("rule_fab_name"),
      spec: t("rule_fab_spec"),
      quantity: 1,
      kind: "electronics",
      critical: true,
      group: "fabrication",
      origin: "rule",
    });
    reasons.set("fab_custom_pcb", [t("rule_fab_reason")]);
  }

  const lim = (xs: string[]) => (xs.length > 6 ? `${xs.slice(0, 6).join("; ")}; +${xs.length - 6}` : xs.join("; "));
  return {
    lines: [...out.values()].map((l) => ({
      ...l,
      reason: lim(reasons.get(l.id) ?? []),
      ...(covered.get(l.id)?.length ? { refs: covered.get(l.id) } : {}),
    })),
    netlist: n,
    levelFlags,
    assumptions,
  };
}

/**
 * The netlist to store: our rules' augmented copy, which must pass the same
 * reference check as the model's (its added parts point at rule line ids).
 * Should our own insertion ever break a reference, the model's netlist is kept
 * instead — its hard-rule flags then block readiness, so nothing is hidden —
 * and the problems are returned for the log.
 */
export function augmentedCircuit(
  model: Netlist | null,
  augmented: Netlist | null,
  lineIds: string[]
): { netlist: Netlist | null; problems: string[] } {
  if (!augmented) return { netlist: model, problems: [] };
  const problems = crossValidate(augmented, lineIds);
  return problems.length ? { netlist: model, problems } : { netlist: augmented, problems: [] };
}
