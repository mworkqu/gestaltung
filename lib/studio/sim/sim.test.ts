// P5-17g "Try it": the behaviour preview follows the product's rules, deterministically.
import { describe, expect, it } from "vitest";

import { buildConnections } from "../connections";
import { getPart } from "../library";
import { buildWiring } from "../netlist";
import { GOLDEN_IDEAS } from "../product/__fixtures__/golden";
import type { StudioComponent } from "../schema";
import { RING_HEX, simModel, SIM_DT, type SimModel } from "./model";
import {
  activeWires,
  effects,
  initialInputs,
  initialState,
  isMoving,
  outputsAttr,
  PULSE_SECONDS,
  step,
  type SimInputs,
  type SimState,
} from "./step";

const comps = (ids: string[]): StudioComponent[] => ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));
const idea = (key: string) => GOLDEN_IDEAS.find((g) => g.key === key)!;

function setup(key: string) {
  const g = idea(key);
  const w = buildWiring(comps(g.partIds), g.spec, getPart, "en");
  const model = simModel({ spec: g.spec, components: w.components }, getPart);
  const connections = buildConnections(w.components, w.netlist.nets, getPart);
  return { model, connections, inputs: initialInputs(model) };
}

/** Runs `seconds` of the 20 Hz clock. */
function run(model: SimModel, s: SimState, inputs: SimInputs, seconds: number): SimState {
  let st = s;
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) st = step(model, st, inputs, SIM_DT);
  return st;
}
const out = (s: SimState, kind: string) => s.outputs.find((o) => o.kind === kind)!;

describe("Plant Waterer", () => {
  const { model, connections, inputs } = setup("plant_waterer");
  const soil = model.controls.find((c) => c.kind === "soil")!;

  it("derives a soil slider with a threshold, and the pump + ring as outputs", () => {
    expect(soil).toBeTruthy();
    expect(soil.type).toBe("slider");
    expect(soil.threshold?.value).toBe(60);
    expect(model.primary).toBe(soil.id);
    expect(model.outputs.map((o) => o.kind).sort()).toEqual(["pump", "ring"]);
    // The motor driver is not an output.
    expect(model.outputs.some((o) => o.partId === "motor_driver")).toBe(false);
  });

  it("the threshold field starts at the number the simulation uses (F-041)", () => {
    // TryItPanel shows inputs.thresholds[id] ?? threshold.value; both must be the model's 60, never blank.
    expect(inputs.thresholds[soil.id]).toBe(soil.threshold!.value);
    expect(Number.isFinite(inputs.thresholds[soil.id])).toBe(true);
    const at = (v: number) => run(model, initialState(model, inputs), { ...inputs, values: { ...inputs.values, [soil.id]: 61 }, thresholds: { [soil.id]: v } }, 0.2);
    expect(out(at(60), "pump").on).toBe(true);
    expect(out(at(65), "pump").on).toBe(false);
  });

  it("wet soil: everything off", () => {
    const s = initialState(model, inputs);
    expect(s.cause).toBe("soilWet");
    expect(out(s, "pump").on).toBe(false);
    expect(out(s, "ring").pixels).toBe(0);
    expect(outputsAttr(s)).toBe("pump:off,ring:off");
  });

  it("dry soil: pump spins, ring shows watering blue, wires to the pump light", () => {
    let s = initialState(model, inputs);
    const dry = { ...inputs, values: { ...inputs.values, [soil.id]: 85 } };
    s = run(model, s, dry, 0.2);
    expect(s.cause).toBe("soilDry");
    expect(out(s, "pump").on).toBe(true);
    expect(out(s, "ring").on).toBe(true);
    expect(out(s, "ring").colour).toBe(RING_HEX.blue);
    expect(out(s, "ring").pixels).toBe(12);
    expect(effects(s)).toEqual(expect.arrayContaining([{ kind: "pump", on: true }, { kind: "ring", on: true, colourName: "blue" }]));
    expect(isMoving(s)).toBe(true);
    const lit = activeWires(model, s, connections);
    expect(lit.size).toBeGreaterThan(0);
    for (const id of lit) expect(["power", "ground"]).not.toContain(connections.find((c) => c.id === id)!.role);
    // The board → motor driver signal is lit (one hop through the driver).
    const driverWire = connections.find((c) => c.role !== "power" && c.role !== "ground" && [c.from.partId, c.to.partId].includes("motor_driver") && [c.from.partId, c.to.partId].includes("esp32_c3_mini"));
    if (driverWire) expect(lit.has(driverWire.id)).toBe(true);
    // Wet again → off.
    s = run(model, s, inputs, 1);
    expect(out(s, "pump").on).toBe(false);
    expect(outputsAttr(s)).toBe("pump:off,ring:off");
    expect(activeWires(model, s, connections).size).toBe(0);
  });

  it("the threshold is editable: drier than 90 % only", () => {
    const s = run(model, initialState(model, inputs), { ...inputs, values: { ...inputs.values, [soil.id]: 85 }, thresholds: { [soil.id]: 90 } }, 0.2);
    expect(out(s, "pump").on).toBe(false);
  });

  it("the sensor's own signal wire flashes when the slider moves", () => {
    let s = initialState(model, inputs);
    s = step(model, s, { ...inputs, values: { ...inputs.values, [soil.id]: 40 } }, SIM_DT);
    const lit = activeWires(model, s, connections);
    const soilWire = connections.find((c) => c.role !== "power" && c.role !== "ground" && [c.from.partId, c.to.partId].includes("soil_moisture_cap"));
    expect(soilWire).toBeTruthy();
    expect(lit.has(soilWire!.id)).toBe(true);
    s = run(model, s, { ...inputs, values: { ...inputs.values, [soil.id]: 40 } }, 1);
    expect(activeWires(model, s, connections).size).toBe(0);
  });
});

describe("cat feeder", () => {
  const { model, inputs } = setup("cat_feeder");
  const btn = model.controls.find((c) => c.kind === "button")!;

  it("button press → servo turns to 90° and comes back", () => {
    expect(btn.type).toBe("hold");
    expect(model.buttonMode).toBe("pulse");
    let s = initialState(model, inputs);
    expect(out(s, "servo").angle).toBe(0);
    // A quick press (shorter than one tick) still counts.
    const pressed = { ...inputs, presses: { [btn.id]: 1 } };
    s = run(model, s, pressed, 0.5);
    expect(out(s, "servo").angle).toBe(90);
    expect(outputsAttr(s)).toBe("servo:90");
    expect(s.cause).toBe("feeding");
    s = run(model, s, pressed, PULSE_SECONDS + 0.6);
    expect(out(s, "servo").angle).toBe(0);
    expect(s.cause).toBe("waiting");
    expect(s.pulseStart).toBeNull();
  });
});

describe("doorbell", () => {
  const { model, inputs } = setup("doorbell");
  const btn = model.controls.find((c) => c.kind === "button")!;

  it("button → speaker rings and the light comes on, then both stop", () => {
    expect(model.buttonMode).toBe("ring");
    let s = initialState(model, inputs);
    expect(out(s, "speaker").on).toBe(false);
    s = run(model, s, { ...inputs, values: { ...inputs.values, [btn.id]: 1 }, presses: { [btn.id]: 1 } }, 0.3);
    expect(out(s, "speaker").on).toBe(true);
    expect(out(s, "speaker").beepHz).toBeGreaterThan(0);
    expect(out(s, "led").on).toBe(true);
    s = run(model, s, { ...inputs, presses: { [btn.id]: 1 } }, 3);
    expect(out(s, "speaker").on).toBe(false);
    expect(out(s, "led").on).toBe(false);
  });
});

describe("desk lamp", () => {
  const { model, inputs } = setup("desk_lamp");

  it("touch (the board's own pin) → ring on in warm white, touch again → off", () => {
    const touch = model.controls.find((c) => c.kind === "touch")!;
    expect(touch).toBeTruthy();
    expect(touch.part).toBeNull();
    expect(model.buttonMode).toBe("toggle");
    let s = initialState(model, inputs);
    expect(out(s, "ring").on).toBe(false);
    s = run(model, s, { ...inputs, presses: { [touch.id]: 1 } }, 0.2);
    expect(out(s, "ring").on).toBe(true);
    expect(out(s, "ring").colour).toBe(RING_HEX.warm);
    expect(s.cause).toBe("switchedOn");
    s = run(model, s, { ...inputs, presses: { [touch.id]: 2 } }, 0.2);
    expect(out(s, "ring").on).toBe(false);
    expect(s.cause).toBe("switchedOff");
  });
});

describe("rule table", () => {
  it("unknown combination: input shown, outputs follow 'active → on'", () => {
    const comps2 = comps(["esp32_devkit", "rtc_ds3231", "relay_module", "buzzer"]);
    const model = simModel({ spec: { inputs: [], outputs: [], features: [] }, components: comps2 }, getPart);
    expect(model.controls.map((c) => c.kind)).toEqual(["time"]);
    const inputs = initialInputs(model);
    let s = initialState(model, inputs);
    expect(out(s, "relay").on).toBe(false);
    s = run(model, s, { ...inputs, values: { [model.controls[0].id]: 21 } }, 0.2);
    expect(out(s, "relay").on).toBe(true);
    expect(out(s, "buzzer").on).toBe(true);
  });

  it("distance: the buzzer beeps faster the closer it gets", () => {
    const model = simModel({ spec: { inputs: [], outputs: [], features: [] }, components: comps(["esp32_devkit", "hcsr04", "buzzer"]) }, getPart);
    const id = model.controls[0].id;
    const inputs = initialInputs(model);
    const near = run(model, initialState(model, inputs), { ...inputs, values: { [id]: 5 } }, 0.2);
    const mid = run(model, initialState(model, inputs), { ...inputs, values: { [id]: 20 } }, 0.2);
    expect(out(near, "buzzer").beepHz!).toBeGreaterThan(out(mid, "buzzer").beepHz!);
  });

  it("DHT22 gives temperature + humidity; PIR gives a motion toggle that stays on for N s", () => {
    const m1 = simModel({ spec: { inputs: [], outputs: [], features: [] }, components: comps(["esp32_devkit", "dht22", "n20_motor"]) }, getPart);
    expect(m1.controls.map((c) => c.kind)).toEqual(["temperature", "humidity"]);
    const m2 = simModel({ spec: { inputs: [], outputs: [], features: [] }, components: comps(["esp32_devkit", "pir_hcsr501", "led_5mm"]) }, getPart);
    const pir = m2.controls[0];
    expect(pir.kind).toBe("motion");
    expect(pir.type).toBe("toggle");
    const inputs = initialInputs(m2);
    let s = run(m2, initialState(m2, inputs), { ...inputs, values: { [pir.id]: 1 } }, 0.2);
    expect(out(s, "led").on).toBe(true);
    s = run(m2, s, { ...inputs, values: { [pir.id]: 0 } }, 3);
    expect(out(s, "led").on).toBe(true); // still within 5 s
    s = run(m2, s, { ...inputs, values: { [pir.id]: 0 } }, 3);
    expect(out(s, "led").on).toBe(false);
  });

  it("MPU6050 is a tilt slider (not motion); no inputs at all → one on/off switch", () => {
    const m = simModel({ spec: { inputs: [], outputs: [], features: [] }, components: comps(["esp32_devkit", "mpu6050", "sg90_servo"]) }, getPart);
    expect(m.controls.map((c) => c.kind)).toEqual(["tilt"]);
    const m2 = simModel({ spec: { inputs: [], outputs: [], features: [] }, components: comps(["esp32_devkit", "led_5mm"]) }, getPart);
    expect(m2.controls.map((c) => c.kind)).toEqual(["power"]);
  });
});

describe("determinism", () => {
  it("the same inputs and ticks give the same states", () => {
    const go = () => {
      const { model, inputs } = setup("plant_waterer");
      const id = model.controls[0].id;
      let s = initialState(model, inputs);
      const trace: string[] = [];
      for (let i = 0; i < 80; i++) {
        const v = 20 + ((i * 37) % 70);
        s = step(model, s, { ...inputs, values: { [id]: v } }, SIM_DT);
        trace.push(JSON.stringify(s));
      }
      return trace;
    };
    expect(go()).toEqual(go());
  });
});
