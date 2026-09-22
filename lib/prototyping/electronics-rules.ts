// Our rules for the electronics bill of materials — not the model's.
//
// Walking the validated netlist, they add what a real build needs and a model
// is unreliable at, each line with the reason it exists:
//   * a current-limiting resistor for every LED without one
//   * a pull-up on every I2C line and every button signal without one
//   * a decoupling capacitor on every bare IC power pin
//   * a flyback diode across every inductive load (DC motor, pump, solenoid, fan)
//   * a logic level shifter where a 5 V output drives a 3.3 V input, and a
//     warning in words where 3.3 V drives 5 V (it may or may not read reliably)
// plus the build consumables the route needs (breadboard, jumper wires,
// perfboard, USB cable, power, wire, heat-shrink) and, on the Custom PCB
// route, the board-fabrication line.
//
// Identical lines are merged: four LEDs give ONE line of four resistors,
// with every LED named in its reason. Line ids are stable, so a line the client
// removed (bom.dismissed) is never added back. Values are orderable: "330 Ω,
// 1/4 W, ±5 %, through-hole", chosen from the E12 series.
//
// Pure. Text comes through the injected `t`, so lines read in either language.

import type { BuildRoute } from "./analysis";
import type { ProjectLine } from "./bom";
import { powerNets, type NetComponent, type Netlist } from "./netlist";
import { symbolKind } from "./schematic-svg";
import { CLASSES, formatValue, type AttrClass } from "@/lib/store/attributes";

type T = (key: string, params?: Record<string, string | number>) => string;

export type LevelFlag = {
  net: string;
  direction: "high_to_low" | "low_to_high";
  drivers: string[];
  receivers: string[];
};

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

const LED_VF: Record<string, number> = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.0, white: 3.0 };
const LED_MA = 10;

type Ctx = {
  netlist: Netlist | null;
  /** The model's electronics lines (boards, modules, sensors, actuators). */
  lines: ProjectLine[];
  route: BuildRoute;
  /** The spec's power fact: mains | battery | solar | null. */
  power: string | null;
  t: T;
};

export type RulesResult = { lines: ProjectLine[]; levelFlags: LevelFlag[]; assumptions: string[] };

export function deriveElectronics({ netlist: n, lines, route, power, t }: Ctx): RulesResult {
  const out = new Map<string, ProjectLine>();
  const reasons = new Map<string, string[]>();
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
    extra: Partial<ProjectLine> = {}
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
        ...extra,
      });
    reasons.set(id, [...(reasons.get(id) ?? []), reason]);
  };

  const levelFlags: LevelFlag[] = [];

  if (n) {
    const { power: powerSet, ground } = powerNets(n);
    const netsOf = (ref: string) => n.nets.filter((x) => x.connections.some((c) => c.ref === ref));
    const byRef = new Map(n.components.map((c) => [c.ref, c]));
    const hasResistor = (netName: string) =>
      n.nets
        .find((x) => x.name === netName)
        ?.connections.some((c) => {
          const k = byRef.get(c.ref);
          return k ? symbolKind(k) === "resistor" : false;
        }) ?? false;

    // A component's logic voltage: its line's logic_v, else the rail its
    // supply pin sits on.
    const logicV = (c: NetComponent): number | null => {
      const lv = Number(lineOf(c)?.attributes?.logic_v);
      if (lv > 0) return lv;
      for (const p of c.pins.filter((p) => p.type === "power_in")) {
        const net = n.nets.find((x) => x.connections.some((k) => k.ref === c.ref && k.pin === p.id));
        const v = net ? parseVolts(net.name) : null;
        if (v) return v;
      }
      return null;
    };
    const boardV =
      n.components.map((c) => (lineOf(c)?.class === "board" ? logicV(c) : null)).find((v) => v) ?? null;

    // LEDs: one current-limiting resistor each.
    for (const c of n.components.filter((c) => symbolKind(c) === "led")) {
      const nets = netsOf(c.ref);
      if (nets.some((x) => hasResistor(x.name))) continue;
      let v: number | null = null;
      for (const x of nets) {
        if (powerSet.has(x.name)) v = Math.max(v ?? 0, parseVolts(x.name) ?? 0) || v;
        else if (!ground.has(x.name))
          for (const k of x.connections)
            if (k.ref !== c.ref) {
              const kv = byRef.get(k.ref) ? logicV(byRef.get(k.ref)!) : null;
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
      add(
        `rule_res_${r}`,
        "resistor",
        { resistance_ohm: r, tolerance_pct: 5, power_w: 0.25, package: "through_hole" },
        t("rule_resistorName"),
        t("rule_resistorSpec", { value: formatValue(r, "Ω") }),
        1,
        t("rule_ledReason", { ref: c.ref, v, ma: LED_MA })
      );
    }

    // I2C: a pull-up on each SDA / SCL line that has none.
    for (const x of n.nets) {
      const isI2C =
        /\b(sda|scl)\b/i.test(x.name.replace(/_/g, " ")) ||
        x.connections.some((k) => /^(sda|scl)$/i.test(byRef.get(k.ref)?.pins.find((p) => p.id === k.pin)?.name ?? ""));
      if (!isI2C || hasResistor(x.name) || powerSet.has(x.name) || ground.has(x.name)) continue;
      add(
        "rule_res_4700",
        "resistor",
        { resistance_ohm: 4700, tolerance_pct: 5, power_w: 0.25, package: "through_hole" },
        t("rule_resistorName"),
        t("rule_resistorSpec", { value: formatValue(4700, "Ω") }),
        1,
        t("rule_i2cReason", { net: x.name })
      );
    }

    // Buttons: a pull-up on each switch signal that has none.
    for (const c of n.components.filter(
      (c) => /^SW\d/i.test(c.ref) || lineOf(c)?.class === "switch" || /\b(button|push ?button)\b/i.test(c.function)
    )) {
      for (const x of netsOf(c.ref)) {
        if (powerSet.has(x.name) || ground.has(x.name) || hasResistor(x.name)) continue;
        add(
          "rule_res_10000",
          "resistor",
          { resistance_ohm: 10000, tolerance_pct: 5, power_w: 0.25, package: "through_hole" },
          t("rule_resistorName"),
          t("rule_resistorSpec", { value: formatValue(10000, "Ω") }),
          1,
          t("rule_buttonReason", { ref: c.ref, net: x.name })
        );
      }
    }

    // Bare ICs: a 100 nF decoupling capacitor per supply pin. Boards and
    // modules already carry their own.
    for (const c of n.components.filter((c) => lineOf(c)?.class === "ic")) {
      for (const p of c.pins.filter((p) => p.type === "power_in")) {
        add(
          "rule_cap_100n",
          "capacitor",
          { capacitance_f: 1e-7, voltage_v: 50, dielectric: "ceramic", package: "through_hole" },
          t("rule_capName"),
          t("rule_capSpec", { value: formatValue(1e-7, "F") }),
          1,
          t("rule_decouplingReason", { ref: c.ref, pin: p.name })
        );
      }
    }

    // Inductive loads: a flyback diode each.
    for (const c of n.components) {
      const l = lineOf(c);
      const type = String(l?.attributes?.actuator_type ?? "");
      const inductive =
        ["dc_motor", "pump", "solenoid", "fan"].includes(type) ||
        (!type && /\b(dc motor|motor|pump|solenoid|fan)\b/i.test(c.function) && !/servo|stepper/i.test(c.function));
      if (!inductive) continue;
      add(
        "rule_diode_flyback",
        "diode",
        { diode_type: "rectifier", current_a: 1, voltage_v: 400, package: "through_hole" },
        t("rule_diodeName"),
        t("rule_diodeSpec"),
        1,
        t("rule_flybackReason", { ref: c.ref })
      );
    }

    // Logic levels across each signal net.
    const shifterNets: string[] = [];
    for (const x of n.nets) {
      if (powerSet.has(x.name) || ground.has(x.name)) continue;
      type End = { ref: string; type: string; v: number | null };
      const ends = x.connections
        .map((k): End | null => {
          const c = byRef.get(k.ref);
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

  // Build consumables: what a prototype cannot be built without.
  const c = (id: string, type: string, size: string, critical = true) =>
    add(`rule_${id}`, "consumable", { consumable_type: type, size }, t(`rule_${id}_name`), t(`rule_${id}_spec`), 1, t(`rule_${id}_reason`), { critical });
  c("breadboard", "breadboard", "830");
  c("jumpers", "jumper_wires", "M-M/M-F/F-F");
  c("perfboard", "perfboard", "", false);
  c("hookup_wire", "hookup_wire", "22 AWG");
  c("heat_shrink", "heat_shrink", "assortment", false);

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
    lines: [...out.values()].map((l) => ({ ...l, reason: lim(reasons.get(l.id) ?? []) })),
    levelFlags,
    assumptions,
  };
}
