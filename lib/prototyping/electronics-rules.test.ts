import { describe, expect, it } from "vitest";

import { augmentedCircuit, deriveElectronics } from "./electronics-rules";
import { crossValidate, hardRules, powerBudget, symbolKind, type Netlist } from "./netlist";
import { dividerNetlist, plantLines, plantNetlist, tKey } from "./plant-monitor.fixture";
import { renderSchematic } from "./schematic-svg";

const netOf = (n: Netlist, ref: string, pin: string) =>
  n.nets.find((x) => x.connections.some((k) => k.ref === ref && k.pin === pin))?.name;

describe("deriveElectronics on the Plant monitor", () => {
  const model = plantNetlist();
  const before = JSON.stringify(model);
  const r = deriveElectronics({ netlist: model, lines: plantLines, route: "prototype", power: null, t: tKey });
  const n = r.netlist!;
  const line = (id: string) => r.lines.find((l) => l.id === id);

  it("never mutates the model's netlist", () => {
    expect(JSON.stringify(model)).toBe(before);
  });

  it("puts a driver, a base resistor and ONE flyback diode on the pump — in the netlist and the lines", () => {
    const refs = n.components.map((c) => c.ref);
    expect(refs).toEqual(expect.arrayContaining(["Q1", "R_B1", "D1"]));
    expect(n.components.filter((c) => symbolKind(c) === "diode")).toHaveLength(1);
    expect(n.components.filter((c) => symbolKind(c) === "transistor")).toHaveLength(1);

    // GPIO → R_B1 → base; emitter → GND; collector → pump low side; pump high side → 5V.
    expect(netOf(n, "R_B1", "1")).toBe("PUMP");
    expect(netOf(n, "U1", "IO25")).toBe("PUMP");
    expect(netOf(n, "R_B1", "2")).toBe(netOf(n, "Q1", "B"));
    expect(netOf(n, "Q1", "E")).toBe("GND");
    expect(netOf(n, "Q1", "C")).toBe(netOf(n, "M1", "2"));
    expect(netOf(n, "M1", "1")).toBe("5V");
    // Flyback: anode on the switched side, cathode on the supply.
    expect(netOf(n, "D1", "A")).toBe(netOf(n, "M1", "2"));
    expect(netOf(n, "D1", "K")).toBe("5V");

    // Same parts, same ids: bomId of each component is its line's id.
    const q = n.components.find((c) => c.ref === "Q1")!;
    const rb = n.components.find((c) => c.ref === "R_B1")!;
    const d = n.components.find((c) => c.ref === "D1")!;
    expect(q.bomId).toBe("rule_npn_300ma_10v");
    expect(line(q.bomId)).toMatchObject({
      class: "transistor",
      origin: "rule",
      quantity: 1,
      refs: ["Q1"],
      attributes: { class: "transistor", transistor_type: "npn", current_a: 0.3, voltage_v: 10, package: "to92" },
    });
    // (3.3 V − 0.7 V) / 10 mA (the board-pin cap; 150 mA / 10 would be 15 mA) = 260 Ω → E12 270 Ω.
    expect(rb.bomId).toBe("rule_res_270");
    expect(line("rule_res_270")).toMatchObject({ class: "resistor", quantity: 1, refs: ["R_B1"] });
    expect(d.bomId).toBe("rule_diode_flyback");
    expect(line("rule_diode_flyback")).toMatchObject({
      class: "diode",
      quantity: 1,
      refs: ["D1"],
      attributes: { diode_type: "rectifier", current_a: 1, voltage_v: 400 },
    });
    expect(r.lines.filter((l) => l.class === "diode")).toHaveLength(1);
  });

  it("puts a resistor in series with each LED — in the netlist and on one line of four", () => {
    for (const i of [1, 2, 3, 4]) {
      const ref = `R_LED${i}`;
      const c = n.components.find((k) => k.ref === ref)!;
      expect(c.bomId).toBe("rule_res_150");
      // Board pin → R_LEDi → LED anode.
      expect(netOf(n, ref, "2")).toBe(netOf(n, `LED${i}`, "A"));
      expect(netOf(n, ref, "1")).toBe(["LED_OK", "LED_DRY", "LED_WET", "LED_WIFI"][i - 1]);
    }
    expect(line("rule_res_150")).toMatchObject({
      quantity: 4,
      refs: ["R_LED1", "R_LED2", "R_LED3", "R_LED4"],
      attributes: { resistance_ohm: 150 },
    });
  });

  it("leaves only the supply conflict, which rules cannot fix", () => {
    expect(hardRules(n)).toEqual([{ code: "shorted_supplies", net: "5V", refs: ["J1", "U1"] }]);
  });

  it("is still a valid netlist against the model's lines plus the rule lines", () => {
    const ids = [...plantLines, ...r.lines].map((l) => l.id);
    expect(crossValidate(n, ids)).toEqual([]);
    expect(augmentedCircuit(model, n, ids)).toEqual({ netlist: n, problems: [] });
    // Without the rule lines the added parts point nowhere: the model's netlist is kept.
    const fallback = augmentedCircuit(model, n, plantLines.map((l) => l.id));
    expect(fallback.netlist).toBe(model);
    expect(fallback.problems.length).toBeGreaterThan(0);
  });

  it("draws every inserted part on the schematic", () => {
    const svg = renderSchematic({ netlist: n, flags: hardRules(n) });
    for (const ref of ["Q1", "R_B1", "D1", "R_LED1", "R_LED4"]) expect(svg).toContain(`>${ref}<`);
  });

  it("counts the pump on the 5V budget once it is wired to the rail", () => {
    expect(powerBudget(n)[0]).toMatchObject({ rail: "5V", drawMa: 390, headroomMa: 110, loads: [{ ref: "U1", ma: 240 }, { ref: "M1", ma: 150 }] });
  });
});

describe("deriveElectronics: flyback without a GPIO", () => {
  it("adds a diode across a load already switched on its low side, and none across a supply or H-bridge", () => {
    const n: Netlist = {
      components: [
        { ref: "J1", function: "adapter jack", bomId: "j", pins: [{ id: "V", name: "V", type: "power_out" }, { id: "G", name: "G", type: "ground" }] },
        { ref: "U1", function: "motor driver", bomId: "d", pins: [{ id: "O1", name: "O1", type: "output" }, { id: "O2", name: "O2", type: "output" }, { id: "O3", name: "O3", type: "output" }] },
        { ref: "M1", function: "fan", bomId: "m", pins: [{ id: "1", name: "+", type: "power_in" }, { id: "2", name: "-", type: "passive" }] },
        { ref: "M2", function: "DC motor", bomId: "m", pins: [{ id: "1", name: "a", type: "passive" }, { id: "2", name: "b", type: "passive" }] },
      ],
      nets: [
        { name: "12V", connections: [{ ref: "J1", pin: "V" }, { ref: "M1", pin: "1" }] },
        { name: "GND", connections: [{ ref: "J1", pin: "G" }] },
        { name: "FAN_LOW", connections: [{ ref: "U1", pin: "O1" }, { ref: "M1", pin: "2" }] },
        { name: "MA", connections: [{ ref: "U1", pin: "O2" }, { ref: "M2", pin: "1" }] },
        { name: "MB", connections: [{ ref: "U1", pin: "O3" }, { ref: "M2", pin: "2" }] },
      ],
      powerRails: [{ name: "12V", sourceRef: "J1", maxCurrentMa: 2000 }],
      notes: [],
    };
    const r = deriveElectronics({ netlist: n, lines: [], route: "prototype", power: null, t: tKey });
    const diodes = r.netlist!.components.filter((c) => symbolKind(c) === "diode");
    expect(diodes.map((d) => d.ref)).toEqual(["D1"]);
    expect(netOf(r.netlist!, "D1", "A")).toBe("FAN_LOW");
    expect(netOf(r.netlist!, "D1", "K")).toBe("12V");
    expect(r.lines.filter((l) => l.class === "diode")).toMatchObject([{ id: "rule_diode_flyback", quantity: 1, refs: ["D1"] }]);
    expect(r.netlist!.components.some((c) => symbolKind(c) === "transistor")).toBe(false);
  });
});

describe("deriveElectronics: review round 1", () => {
  it("inserts R_LED1 for an LED whose only resistor neighbour is a divider on GND", () => {
    const r = deriveElectronics({ netlist: dividerNetlist(), lines: plantLines, route: "prototype", power: null, t: tKey });
    const n = r.netlist!;
    expect(n.components.some((c) => c.ref === "R_LED1")).toBe(true);
    expect(netOf(n, "R_LED1", "1")).toBe("LED");
    expect(netOf(n, "R_LED1", "2")).toBe(netOf(n, "LED1", "A"));
    expect(hardRules(n)).toEqual([]);
  });

  it("sizes an unstated load at 200 mA and says so — the same figure the Power leaf counts", () => {
    const model = plantNetlist();
    model.components.find((c) => c.ref === "M1")!.currentMa = null;
    const r = deriveElectronics({ netlist: model, lines: plantLines, route: "prototype", power: null, t: tKey });
    expect(r.assumptions).toContain('rule_assumedLoad {"ref":"M1","ma":200}');
    expect(r.lines.some((l) => l.id === "rule_npn_400ma_10v")).toBe(true);
    expect(powerBudget(r.netlist!)[0].loads).toContainEqual({ ref: "M1", ma: 200, assumed: true });
  });
});
