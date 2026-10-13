import { beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_LIBRARY } from "../library";
import { clampSpec, type ClampLog, type ProductSpec } from "../schema";
import { GOLDEN_IDEAS } from "../product/__fixtures__/golden";
import { applyActuatorRules, capKinds, freePwmPins, servoMix, type Slot } from "./actuator-rules";
import { fakeModel } from "./fake-model";
import { enforcePick, runPick } from "./pick";
import { servoPlan } from "../servo-plan";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const INDEX = CODE_LIBRARY.libraryIndexForAI();
const BY_ID = new Map(INDEX.map((e) => [e.id, e]));
const pinsOf = (id: string) => CODE_LIBRARY.getPart(id)?.pins;
const name = (id: string) => CODE_LIBRARY.getPart(id)?.name.en ?? id;
const spec = (over: Record<string, unknown> = {}): ProductSpec =>
  clampSpec({ name: "Robotic Arm", oneLine: "A desktop arm that moves like a UR10.", use: "desk", power: "mains_adapter", ...over });
const slots = (...partIds: string[]): Slot[] => partIds.map((partId) => ({ partId, label: name(partId) }));
const rules = (list: Slot[], s: ProductSpec, withPins = true) =>
  applyActuatorRules(list, { spec: s, byId: BY_ID, log: [], name, ...(withPins ? { pinsOf } : {}) });
const ids = (list: readonly { partId: string }[]) => list.map((s) => s.partId);
const count = (list: readonly { partId: string }[], id: string) => list.filter((s) => s.partId === id).length;
const pick = (components: string[], s: ProductSpec) =>
  enforcePick(
    { components: components.map((partId) => ({ partId })) },
    { spec: s, index: INDEX, locale: "en", log: [], nameFor: (id) => name(id), pinsOf },
  );

const ARM6 = { actuators: [{ kind: "servo", count: 6, load: "medium", role: "arm joints" }] };
const BUSY_C3 = ["esp32_c3_mini", "button_6mm", "button_6mm", "button_6mm", "button_6mm", "led_5mm", "led_5mm", "dht22", "sg90_servo", "sg90_servo"];

describe("servoMix", () => {
  it("an arm with one load: base/shoulder/elbow strong, the rest light", () => {
    expect(servoMix(spec(ARM6))).toEqual({ strong: 3, light: 3 });
    expect(servoMix(spec({ actuators: [{ kind: "servo", count: 4, load: "heavy" }] }))).toEqual({ strong: 3, light: 1 });
    expect(servoMix(spec({ actuators: [{ kind: "servo", count: 3, load: "medium" }] }))).toEqual({ strong: 3, light: 0 });
  });

  it("per-group loads win; not an arm = the load says it", () => {
    const groups = [
      { kind: "servo", count: 2, load: "heavy" },
      { kind: "servo", count: 4, load: "light" },
    ];
    expect(servoMix(spec({ actuators: groups }))).toEqual({ strong: 2, light: 4 });
    const panTilt = spec({ name: "Camera pan-tilt", oneLine: "Turns a camera.", actuators: [{ kind: "servo", count: 2, load: "light" }] });
    expect(servoMix(panTilt)).toEqual({ strong: 0, light: 2 });
    expect(servoMix(spec())).toBeNull();
  });
});

describe("enforcePick + actuator rules", () => {
  it("6-axis arm: 3 MG996R + 3 SG90 + PCA9685 + 5 V 5 A supply, instance ids kept", () => {
    const p = pick(["esp32_devkit", "sg90_servo"], spec(ARM6));
    expect(count(p.components, "mg996r_servo")).toBe(3);
    expect(count(p.components, "sg90_servo")).toBe(3);
    expect(count(p.components, "pca9685_servo")).toBe(1);
    expect(count(p.components, "psu_5v_5a")).toBe(1);
    expect(p.components[0].partId).toBe("esp32_devkit");
    expect(p.components.filter((c) => c.partId === "mg996r_servo").map((c) => c.instanceId)).toEqual([
      "mg996r_servo_1",
      "mg996r_servo_2",
      "mg996r_servo_3",
    ]);
  });

  it("trims a model that over-picks servos and keeps a pair off the driver", () => {
    const s = spec({ name: "Pan-tilt camera", oneLine: "Turns a camera.", power: "usb", actuators: [{ kind: "servo", count: 2, load: "light" }] });
    const p = pick(["arduino_uno", "sg90_servo", "sg90_servo", "sg90_servo", "sg90_servo", "sg90_servo", "mg996r_servo"], s);
    expect(ids(p.components)).toEqual(["arduino_uno", "sg90_servo", "sg90_servo"]);
  });

  it("≥ 3 servos → the driver, even when the board has the pins", () => {
    const out = rules(slots("arduino_uno", "sg90_servo", "sg90_servo", "sg90_servo"), spec({ name: "Fan flaps", oneLine: "" }));
    expect(count(out, "pca9685_servo")).toBe(1);
    expect(ids(out).indexOf("pca9685_servo")).toBeLessThan(ids(out).indexOf("sg90_servo"));
  });

  it("more servos than free PWM pins → the driver (2 servos on a busy ESP32-C3 mini)", () => {
    const busy = slots(...BUSY_C3);
    expect(freePwmPins("esp32_c3_mini", busy.filter((s) => s.partId !== "sg90_servo"), { byId: BY_ID, pinsOf })).toBeLessThan(2);
    const out = rules(busy, spec({ name: "Toy", oneLine: "" }));
    expect(count(out, "pca9685_servo")).toBe(1);
    expect(out[0].partId).toBe("esp32_c3_mini"); // with the driver, I2C is enough
    // Without the pin data only the "≥ 3 servos" rule applies.
    expect(count(rules(busy, spec({ name: "Toy", oneLine: "" }), false), "pca9685_servo")).toBe(0);
  });

  it("no driver in the library and the C3 is out of pins → a bigger board", () => {
    const noDriver = new Map([...BY_ID].filter(([id]) => id !== "pca9685_servo"));
    const log: ClampLog = [];
    const out = applyActuatorRules(slots(...BUSY_C3), { spec: spec({ name: "Toy", oneLine: "" }), byId: noDriver, log, name, pinsOf });
    expect(out[0].partId).not.toBe("esp32_c3_mini");
    expect(log.some((l) => l.path === "components.mcu.pins")).toBe(true);
  });

  it("servo stall current over the supply → the 5 V 5 A supply replaces it (and the battery)", () => {
    const two = { name: "Big flaps", oneLine: "", actuators: [{ kind: "servo", count: 2, load: "heavy" }] };
    const p = pick(["esp32_devkit", "usbc_power_5v", "mg996r_servo", "mg996r_servo"], spec({ ...two, power: "usb" }));
    expect(count(p.components, "psu_5v_5a")).toBe(1);
    expect(count(p.components, "usbc_power_5v")).toBe(0);
    const b = pick(["esp32_devkit", "mg996r_servo", "mg996r_servo"], spec({ ...two, power: "battery_usb" }));
    expect(ids(b.components)).not.toContain("cell_18650");
    expect(ids(b.components)).not.toContain("tp4056_usbc");
    expect(count(b.components, "psu_5v_5a")).toBe(1);
    // One SG90 (250 mA) on USB: nothing changes.
    const feeder = pick(["esp32_devkit", "sg90_servo"], spec({ name: "Feeder", oneLine: "", power: "usb" }));
    expect(ids(feeder.components)).toEqual(["esp32_devkit", "sg90_servo"]);
  });

  it("pumps and motors follow the spec's count", () => {
    const s = spec({ name: "Two-plant waterer", oneLine: "", outputs: ["pump"], actuators: [{ kind: "pump", count: 2, load: "light" }] });
    expect(count(pick(["esp32_devkit"], s).components, "pump_5v")).toBe(2);
    const car = spec({ name: "Robot car", oneLine: "", actuators: [{ kind: "motor", count: 2, load: "medium", role: "wheels" }] });
    expect(count(pick(["esp32_devkit", "n20_motor", "n20_motor", "n20_motor"], car).components, "n20_motor")).toBe(2);
  });

  it("the golden fixtures (plant waterer, desk lamp, cat feeder, doorbell, TV remote) are unchanged", () => {
    for (const g of GOLDEN_IDEAS) {
      const list = slots(...g.partIds);
      expect(rules(list, g.spec), g.key).toEqual(list);
    }
    const plant = GOLDEN_IDEAS.find((g) => g.key === "plant_waterer")!;
    expect(count(pick(plant.partIds, plant.spec).components, "pump_5v")).toBe(1);
  });

  it("the model is told the count", async () => {
    const m = fakeModel([{ components: [{ partId: "esp32_devkit", label: "Brain" }] }]);
    const r = await runPick({ call: m.call, spec: spec(ARM6), index: INDEX, locale: "en", pinsOf });
    expect(m.prompts[0]).toContain("include exactly this many");
    expect(r.ok && count(r.value.components, "mg996r_servo")).toBe(3);
  });
});

describe("capKinds", () => {
  it("6 servos are one slot; at most 8 of one part", () => {
    const list = slots("esp32_devkit", ...Array<string>(6).fill("sg90_servo"), ...Array<string>(11).fill("led_5mm"));
    const out = capKinds(list, 2, []);
    expect(count(out, "sg90_servo")).toBe(6);
    expect(count(out, "led_5mm")).toBe(0);
    expect(count(capKinds(list, 12, []), "led_5mm")).toBe(8);
  });
});

describe("servoPlan (Part E hand-over)", () => {
  it("6-axis arm: channels 0..5 on the driver, roles from the spec, powered from the 5 A supply", () => {
    const arm = spec({
      actuators: [
        { kind: "servo", count: 3, load: "heavy", role: "base, shoulder, elbow" },
        { kind: "servo", count: 3, load: "light", role: "wrist, wrist turn, gripper" },
      ],
    });
    const p = pick(["esp32_devkit"], arm);
    const plan = servoPlan(p.components, arm, CODE_LIBRARY.getPart)!;
    expect(plan.driver).toBe("pca9685_servo_1");
    expect(plan.supply).toBe("psu_5v_5a_1");
    expect(plan.poweredFrom).toBe("supply");
    expect(plan.supplyMA).toBe(5000);
    expect(plan.stallMA).toBe(3 * 2500 + 3 * 250);
    expect(plan.servos.map((s) => [s.instanceId, s.channel, s.role])).toEqual([
      ["mg996r_servo_1", 0, "base"],
      ["mg996r_servo_2", 1, "shoulder"],
      ["mg996r_servo_3", 2, "elbow"],
      ["sg90_servo_1", 3, "wrist"],
      ["sg90_servo_2", 4, "wrist turn"],
      ["sg90_servo_3", 5, "gripper"],
    ]);
  });

  it("one small servo stays on the board; no servos = no plan", () => {
    const comps = [{ partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "" }, { partId: "sg90_servo", instanceId: "sg90_servo_1", label: "" }];
    expect(servoPlan(comps, {}, CODE_LIBRARY.getPart)).toMatchObject({ driver: null, poweredFrom: "board", servos: [{ channel: null }] });
    expect(servoPlan(comps.slice(0, 1), {}, CODE_LIBRARY.getPart)).toBeNull();
  });
});
