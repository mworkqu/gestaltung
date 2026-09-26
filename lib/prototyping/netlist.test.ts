import { describe, expect, it } from "vitest";

import {
  crossValidate,
  hardFlagId,
  hardRules,
  isInductiveLoad,
  powerBudget,
  sanityChecks,
  supplyConflictErrors,
  symbolKind,
  type Netlist,
  type Pin,
  type PinType,
} from "./netlist";
import { dividerNetlist, plantLines, plantNetlist } from "./plant-monitor.fixture";
import { checkModelNetlist } from "./electronics-gen";

const pin = (id: string, type: PinType): Pin => ({ id, name: id, type });

/** A board driving one thing on net SIG, with a 5 V rail from J1. */
function small(extra: Netlist["components"], sig: { ref: string; pin: string }[], more: Netlist["nets"] = []): Netlist {
  return {
    components: [
      { ref: "J1", function: "USB connector", bomId: "j", currentMa: 0, pins: [pin("V", "power_out"), pin("G", "ground")] },
      { ref: "U1", function: "controller board", bomId: "u", currentMa: 100, pins: [pin("VIN", "power_in"), pin("G", "ground"), pin("IO", "output")] },
      ...extra,
    ],
    nets: [
      { name: "5V", connections: [{ ref: "J1", pin: "V" }, { ref: "U1", pin: "VIN" }] },
      { name: "GND", connections: [{ ref: "J1", pin: "G" }, { ref: "U1", pin: "G" }] },
      { name: "SIG", connections: [{ ref: "U1", pin: "IO" }, ...sig] },
      ...more,
    ],
    powerRails: [{ name: "5V", sourceRef: "J1", maxCurrentMa: 500 }],
    notes: [],
  };
}

describe("hardRules: inductive_on_gpio", () => {
  it("flags a motor on a board pin", () => {
    const n = small([{ ref: "M1", function: "DC motor", bomId: "m", pins: [pin("1", "input"), pin("2", "ground")] }], [{ ref: "M1", pin: "1" }]);
    expect(hardRules(n)).toEqual([{ code: "inductive_on_gpio", ref: "M1", net: "SIG", controller: "U1" }]);
  });

  it("does not flag a load behind a transistor", () => {
    const n = small(
      [
        { ref: "Q1", function: "NPN transistor", bomId: "q", pins: [pin("B", "passive"), pin("C", "passive"), pin("E", "passive")] },
        { ref: "R1", function: "resistor", bomId: "r", pins: [pin("1", "passive"), pin("2", "passive")] },
        { ref: "M1", function: "pump", bomId: "m", pins: [pin("1", "power_in"), pin("2", "passive")] },
      ],
      [{ ref: "R1", pin: "1" }],
      [
        { name: "B", connections: [{ ref: "R1", pin: "2" }, { ref: "Q1", pin: "B" }] },
        { name: "C", connections: [{ ref: "Q1", pin: "C" }, { ref: "M1", pin: "2" }] },
      ]
    );
    expect(hardRules(n).filter((f) => f.code === "inductive_on_gpio")).toEqual([]);
  });

  it("does not flag a servo, a stepper or a module; reads Arabic function text", () => {
    expect(isInductiveLoad({ ref: "M1", function: "servo motor", bomId: "x", pins: [] })).toBe(false);
    expect(isInductiveLoad({ ref: "M1", function: "stepper motor", bomId: "x", pins: [] })).toBe(false);
    expect(isInductiveLoad({ ref: "U3", function: "relay module", bomId: "x", pins: [] })).toBe(false);
    expect(isInductiveLoad({ ref: "K1", function: "relay", bomId: "x", pins: [] })).toBe(true);
    expect(isInductiveLoad({ ref: "M1", function: "مضخة مياه", bomId: "x", pins: [] })).toBe(true);
    expect(isInductiveLoad({ ref: "M1", function: "محرك سيرفو", bomId: "x", pins: [] })).toBe(false);
    // A role from the BOM line wins over the text.
    expect(isInductiveLoad({ ref: "M1", function: "pump", bomId: "x", pins: [], role: "other" })).toBe(false);
  });

  it("does not flag a load driven by a motor-driver output", () => {
    const n = small(
      [
        { ref: "U2", function: "motor driver", bomId: "d", pins: [pin("IN", "input"), pin("OUT", "output")] },
        { ref: "M1", function: "DC motor", bomId: "m", pins: [pin("1", "passive"), pin("2", "passive")] },
      ],
      [{ ref: "U2", pin: "IN" }],
      [{ name: "OUT", connections: [{ ref: "U2", pin: "OUT" }, { ref: "M1", pin: "1" }] }]
    );
    expect(hardRules(n).filter((f) => f.code === "inductive_on_gpio")).toEqual([]);
  });
});

describe("hardRules: led_no_resistor", () => {
  it("flags an LED without a resistor, not one with", () => {
    const bare = small([{ ref: "LED1", function: "LED", bomId: "l", pins: [pin("A", "input"), pin("K", "passive")] }], [{ ref: "LED1", pin: "A" }]);
    expect(hardRules(bare)).toEqual([{ code: "led_no_resistor", ref: "LED1" }]);

    const fixed = small(
      [
        { ref: "R_LED1", function: "Resistor 150 Ω", bomId: "r", pins: [pin("1", "passive"), pin("2", "passive")] },
        { ref: "LED1", function: "LED", bomId: "l", pins: [pin("A", "input"), pin("K", "passive")] },
      ],
      [{ ref: "R_LED1", pin: "1" }],
      [{ name: "LED1_A", connections: [{ ref: "R_LED1", pin: "2" }, { ref: "LED1", pin: "A" }] }]
    );
    expect(hardRules(fixed)).toEqual([]);
  });

  it("reads our rule refs as the right symbols", () => {
    const k = (ref: string) => symbolKind({ ref, function: "x", bomId: "x", pins: [] });
    expect([k("R_LED1"), k("R_B1"), k("R_PU2"), k("Q1"), k("D1"), k("DHT1"), k("C1")]).toEqual([
      "resistor",
      "resistor",
      "resistor",
      "transistor",
      "diode",
      "ic",
      "capacitor",
    ]);
  });
});

describe("hardRules: shorted_supplies and power_budget", () => {
  it("flags two supplies on one net", () => {
    const n = small([], []);
    n.components[1].pins.push(pin("5V", "power_out"));
    n.nets[0].connections.push({ ref: "U1", pin: "5V" });
    expect(hardRules(n)).toContainEqual({ code: "shorted_supplies", net: "5V", refs: ["J1", "U1"] });
  });

  it("flags a rail over budget, with the numbers", () => {
    const n = small([{ ref: "M1", function: "fan", bomId: "m", currentMa: 450, pins: [pin("1", "power_in"), pin("2", "ground")] }], []);
    n.nets[0].connections.push({ ref: "M1", pin: "1" });
    n.nets[1].connections.push({ ref: "M1", pin: "2" });
    expect(hardRules(n)).toEqual([{ code: "power_budget", rail: "5V", drawMa: 550, maxMa: 500, refs: ["U1", "M1"] }]);
    expect(powerBudget(n)).toEqual([
      { rail: "5V", sourceRef: "J1", maxMa: 500, loads: [{ ref: "U1", ma: 100 }, { ref: "M1", ma: 450 }], drawMa: 550, headroomMa: -50 },
    ]);
  });

  it("sanityChecks takes supply conflicts and budgets from hardRules", () => {
    const n = small([{ ref: "M1", function: "fan", bomId: "m", currentMa: 450, pins: [pin("1", "power_in"), pin("2", "ground")] }], []);
    n.nets[0].connections.push({ ref: "M1", pin: "1" });
    n.nets[1].connections.push({ ref: "M1", pin: "2" });
    expect(sanityChecks(n)).toContainEqual({ code: "overcurrent", rail: "5V", drawMa: 550, maxMa: 500, refs: ["U1", "M1"] });
  });
});

describe("hardRules: the Plant monitor as drawn", () => {
  const n = plantNetlist();

  it("is a valid netlist", () => {
    expect(crossValidate(n, plantLines.map((l) => l.id))).toEqual([]);
  });

  it("flags the pump, four LEDs and the 5V supply conflict — and nothing else", () => {
    const flags = hardRules(n);
    expect(flags.map(hardFlagId)).toEqual([
      "circuit:inductive_on_gpio:M1",
      "circuit:led_no_resistor:LED1",
      "circuit:led_no_resistor:LED2",
      "circuit:led_no_resistor:LED3",
      "circuit:led_no_resistor:LED4",
      "circuit:shorted_supplies:5V",
    ]);
    expect(flags[0]).toEqual({ code: "inductive_on_gpio", ref: "M1", net: "PUMP", controller: "U1" });
    expect(flags[5]).toEqual({ code: "shorted_supplies", net: "5V", refs: ["J1", "U1"] });
  });

  it("budgets the 5V rail from J1 at 500 mA", () => {
    expect(powerBudget(n)[0]).toMatchObject({ rail: "5V", sourceRef: "J1", maxMa: 500, drawMa: 240, headroomMa: 260 });
  });
});

describe("review round 1", () => {
  it("a resistor on the LED's ground net (a divider) does not count as its series resistor", () => {
    expect(hardRules(dividerNetlist())).toEqual([{ code: "led_no_resistor", ref: "LED1" }]);
  });

  it("feeds the Plant monitor's supply conflict back to the model, by pin, on the first answer only", () => {
    const want = [
      "net 5V has power_out pins on J1.VBUS and U1.5V — only one supply may drive a net; a board fed from a supply takes it on a power_in pin",
    ];
    expect(supplyConflictErrors(plantNetlist())).toEqual(want);
    const ids = plantLines.map((l) => l.id);
    expect(checkModelNetlist(plantNetlist(), ids)).toEqual({ value: null, errors: want });
    // The last answer is kept, conflict and all: it reaches the client as a named blocker.
    expect(checkModelNetlist(plantNetlist(), ids, { supplies: false }).errors).toEqual([]);
  });

  it("budgets an inductive load with no stated current at the driver's assumed 200 mA", () => {
    const n = small([{ ref: "M1", function: "water pump", bomId: "m", pins: [pin("1", "power_in"), pin("2", "passive")] }], []);
    n.nets[0].connections.push({ ref: "M1", pin: "1" });
    expect(powerBudget(n)[0].loads).toEqual([{ ref: "U1", ma: 100 }, { ref: "M1", ma: 200, assumed: true }]);
    expect(powerBudget(n)[0].drawMa).toBe(300);
  });
});
