// Part E: a robot arm (servos on a PCA9685 servo driver, fed by the 5 V 5 A wall supply)
// through every step that reads the wiring: netlist, checks, power budget, connections,
// drawings, 3D layout + router, pin list, code pin block, Try it and the Wokwi export.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lineLinks } from "./code-link";
import { buildConnections, endName, instanceNames, netColourMap, pinBlock, pinConstants, replacePinBlock, type Connection } from "./connections";
import { enforcePick } from "./ai/pick";
import { CODE_LIBRARY, getPart } from "./library";
import { enclosedItems, layoutComponents } from "./layout";
import { buildWiring, isDriver, resolveRequired } from "./netlist";
import { pinListRows } from "./pin-list";
import { SERVO_SHARE_TEXT } from "./plain-checks";
import { renderSchematicSVG } from "./schematic";
import type { ProductSpec } from "./schema";
import { servoNames, servoPlan, servoPlanMA, servoWorstCaseMA } from "./servo-plan";
import { JOINT_SLIDERS_MAX, simModel, SIM_DT } from "./sim/model";
import { initialInputs, initialState, outputsAttr, step } from "./sim/step";
import { renderWiringSVG } from "./wiring-drawing";
import { overlappingLabels, pinLabelLayout } from "./wiring3d/pin-labels";
import { layoutMat } from "./wiring3d/layout";
import { planWires } from "./wiring3d/wires";
import { wokwiDiagram } from "./wokwi";
import { ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC, robotArmComponents } from "./__fixtures__/robot-arm";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const EIGHT = [...ROBOT_ARM_PART_IDS, "sg90_servo", "sg90_servo"];
const SPEC8: ProductSpec = {
  ...ROBOT_ARM_SPEC,
  actuators: [
    { kind: "servo", count: 3, load: "heavy", role: "base, shoulder, elbow" },
    { kind: "servo", count: 5, load: "light" },
  ],
};

function arm(ids: readonly string[] = ROBOT_ARM_PART_IDS, spec: ProductSpec = ROBOT_ARM_SPEC, locale: "en" | "ar" = "en") {
  const w = buildWiring(robotArmComponents(ids), spec, getPart, locale);
  const connections = buildConnections(w.components, w.netlist.nets, getPart, spec);
  return { w, connections, nets: w.netlist.nets };
}
const netOf = (nets: { name: string; pins: string[] }[], ref: string) => nets.find((n) => n.pins.includes(ref))?.name;

describe("robot arm fixture", () => {
  it("is what the Part D rules make of the model's pick", () => {
    const p = enforcePick(
      { components: ["esp32_devkit", "sg90_servo"].map((partId) => ({ partId })) },
      { spec: ROBOT_ARM_SPEC, index: CODE_LIBRARY.libraryIndexForAI(), locale: "en", log: [], nameFor: (id) => id, pinsOf: (id) => getPart(id)?.pins },
    );
    expect(p.components.map((c) => c.partId)).toEqual(ROBOT_ARM_PART_IDS);
    expect(p.components.map((c) => c.instanceId)).toEqual(robotArmComponents().map((c) => c.instanceId));
  });
});

describe("buildWiring with a PCA9685", () => {
  const { w, nets } = arm();

  it("I2C + 3.3 V logic to the board; V+ terminal on the supply's 5 V with the board; common ground", () => {
    expect(netOf(nets, "pca9685_servo_1.SDA")).toBe(netOf(nets, "esp32_devkit_1.GPIO21"));
    expect(netOf(nets, "pca9685_servo_1.SCL")).toBe(netOf(nets, "esp32_devkit_1.GPIO22"));
    expect(netOf(nets, "pca9685_servo_1.VCC")).toBe(netOf(nets, "esp32_devkit_1.3V3"));
    const v = netOf(nets, "pca9685_servo_1.V_PLUS");
    expect(v).toBe(netOf(nets, "psu_5v_5a_1.OUT_5V"));
    // The board is powered from the same supply.
    expect(netOf(nets, "esp32_devkit_1.VIN")).toBe(v);
    const gnd = nets.find((n) => n.name === "GND")!.pins;
    for (const r of ["esp32_devkit_1.GND_L", "psu_5v_5a_1.GND", "pca9685_servo_1.GND", "pca9685_servo_1.V_GND"]) expect(gnd).toContain(r);
    expect(w.unconnected).toEqual([]);
  });

  it("each servo on its channel (signal, V+, GND), in pick order; open channels and OE stay open", () => {
    const servos = ["mg996r_servo_1", "mg996r_servo_2", "mg996r_servo_3", "sg90_servo_1", "sg90_servo_2", "sg90_servo_3"];
    servos.forEach((s, ch) => {
      expect(nets.find((n) => n.name === netOf(nets, `${s}.SIG`))!.pins.sort()).toEqual([`pca9685_servo_1.CH${ch}_PWM`, `${s}.SIG`].sort());
      expect(nets.find((n) => n.name === netOf(nets, `${s}.VCC`))!.pins.sort()).toEqual([`pca9685_servo_1.CH${ch}_V`, `${s}.VCC`].sort());
      expect(nets.find((n) => n.name === netOf(nets, `${s}.GND`))!.pins.sort()).toEqual([`pca9685_servo_1.CH${ch}_GND`, `${s}.GND`].sort());
    });
    expect(netOf(nets, "pca9685_servo_1.OE")).toBeUndefined();
    expect(netOf(nets, "pca9685_servo_1.CH6_PWM")).toBeUndefined();
  });

  it("servos are never on a board pin (no 5V-pin servo power, no board PWM pin)", () => {
    for (const n of nets) {
      const servo = n.pins.some((r) => /^(mg996r|sg90)_servo_/.test(r));
      if (servo) expect(n.pins.some((r) => r.startsWith("esp32_devkit_1."))).toBe(false);
    }
  });

  it("plain checks say it in words, EN + AR (Western digits), and nothing needs attention", () => {
    expect(w.checks.filter((c) => !c.ok)).toEqual([]);
    expect(w.checks[0]).toEqual({ id: "ok_servos", ok: true, plain: "6 servos share the 5 A supply through the servo driver." });
    const ar = arm(ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC, "ar").w.checks.find((c) => c.id === "ok_servos")!;
    expect(ar.plain).toBe(SERVO_SHARE_TEXT.ar.replace("{n}", "6").replace("{amps}", "5"));
    expect(ar.plain).toMatch(/6.*5/);
    expect(ar.plain).not.toMatch(/[٠-٩]/);
  });

  it("the legacy circuit: the supply is the 5 V rail's source; every servo is powered", () => {
    const rail = w.legacy.powerRails.find((r) => r.sourceRef === "psu_5v_5a_1");
    expect(rail).toMatchObject({ name: "5V", maxCurrentMa: 5000 });
    expect(w.legacy.powerRails.some((r) => r.name === "5V" && r.sourceRef === "esp32_devkit_1")).toBe(false);
  });

  it("the servo driver is not a motor driver: a pump next to it still gets its own driver", () => {
    expect(isDriver(getPart("pca9685_servo")!)).toBe(false);
    const r = resolveRequired(robotArmComponents([...ROBOT_ARM_PART_IDS, "pump_5v"]), getPart);
    expect(r.added.map((a) => a.reasonKey)).toContain("driver");
  });
});

describe("power budget: the realistic worst case", () => {
  it("largest stall in full + every other servo at one third", () => {
    expect(servoWorstCaseMA([])).toBe(0);
    expect(servoWorstCaseMA([2500])).toBe(2500);
    expect(servoWorstCaseMA([250, 2500, 250, 2500, 2500, 250])).toBeCloseTo(2500 + (2 * 2500) / 3 + (3 * 250) / 3, 6);
  });

  it("the 6-axis arm passes on the 5 A supply (≈ 4.4 A)", () => {
    const plan = servoPlan(robotArmComponents(), ROBOT_ARM_SPEC, getPart)!;
    expect(plan.supplyMA).toBe(5000);
    const ma = servoPlanMA(plan, getPart);
    expect(ma).toBeGreaterThan(4400);
    expect(ma).toBeLessThan(4450);
    expect(arm().w.checks.some((c) => c.id === "power_budget")).toBe(false);
  });

  it("over the supply → the existing blocking power line", () => {
    // Six MG996R: 2500 + 5 × 833 ≈ 6.7 A > 5 A.
    const six = ["esp32_devkit", "psu_5v_5a", "pca9685_servo", ...Array(6).fill("mg996r_servo")];
    const checks = arm(six).w.checks;
    expect(checks.find((c) => c.id === "power_budget")).toMatchObject({ ok: false });
    expect(checks.some((c) => c.id === "ok_servos")).toBe(false);
    // The 6-axis arm on the 3 A USB-C supply: ≈ 4.6 A > 3 A.
    const usb = ROBOT_ARM_PART_IDS.map((id) => (id === "psu_5v_5a" ? "usbc_power_5v" : id));
    expect(arm(usb).w.checks.some((c) => c.id === "power_budget" && !c.ok)).toBe(true);
  });
});

describe("connections: 6 identical-ish servos, one plug each", () => {
  const { connections } = arm();
  const plugs = connections.filter((c) => c.bundle);

  it("one connection per servo plug, in channel order, with V+ / GND strands", () => {
    expect(plugs.map((c) => c.channel)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const c of plugs) {
      expect(c.role).toBe("pwm");
      expect(c.from.label).toBe(`CH${c.channel}`);
      expect(c.bundle!.map((b) => [b.role, b.from.pin])).toEqual([
        ["power", `CH${c.channel}_V`],
        ["ground", `CH${c.channel}_GND`],
      ]);
    }
    const colours = netColourMap(connections);
    for (const b of plugs.flatMap((c) => c.bundle!)) expect(colours.get(b.net)).toBe(b.role === "power" ? "red" : "black");
  });

  it("names from the actuator roles, no duplicates, EN + AR", () => {
    const en = plugs.map((c) => endName(c.to, getPart, "en"));
    expect(en).toEqual([
      "Servo 1 — base",
      "Servo 2 — shoulder",
      "Servo 3 — elbow",
      "Servo 4 — wrist pitch",
      "Servo 5 — wrist roll",
      "Servo 6 — gripper",
    ]);
    const ar = plugs.map((c) => endName(c.to, getPart, "ar"));
    expect(new Set(ar).size).toBe(6);
    expect(ar[0]).toBe("سيرفو 1 — base");
  });

  it("without roles the servos are numbered; one servo keeps its part name", () => {
    const names = servoNames(robotArmComponents(), {}, getPart, "en");
    expect([...names.values()]).toEqual(["Servo 1", "Servo 2", "Servo 3", "Servo 4", "Servo 5", "Servo 6"]);
    // A role shared by several servos names none of them.
    const shared = servoNames(robotArmComponents(), { actuators: [{ kind: "servo", count: 6, load: "medium", role: "arm joints" }] }, getPart, "en");
    expect(shared.get("sg90_servo_3")).toBe("Servo 6");
    expect(servoNames(robotArmComponents(["esp32_devkit", "sg90_servo"]), {}, getPart, "en").size).toBe(0);
  });

  it("8 servos: 8 plugs, 8 different names", () => {
    const eight = arm(EIGHT, SPEC8).connections;
    const names = eight.filter((c) => c.bundle).map((c) => endName(c.to, getPart, "en"));
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    expect(names.slice(0, 3)).toEqual(["Servo 1 — base", "Servo 2 — shoulder", "Servo 3 — elbow"]);
  });
});

describe("pin list", () => {
  it("6 servo rows, one per plug, named, with the plug note", () => {
    const { connections } = arm();
    const rows = pinListRows(connections, getPart, "en");
    const servoRows = rows.filter((r) => /^Servo \d/.test(r.toPart));
    expect(servoRows).toHaveLength(6);
    expect(servoRows[0]).toMatchObject({ boardPin: "Servo driver board CH0", toPart: "Servo 1 — base", partPin: "Signal" });
    expect(servoRows[0].note).toMatch(/3-wire plug on channel 0/);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    const ar = pinListRows(connections, getPart, "ar").filter((r) => /^سيرفو \d/.test(r.toPart));
    expect(ar).toHaveLength(6);
    expect(ar[5].note).toContain("5");
  });
});

describe("code pin block", () => {
  it("PCA9685 address + one channel constant per servo, names from roles", () => {
    const { connections } = arm();
    const constants = pinConstants(connections, getPart);
    const block = pinBlock(constants);
    expect(block).toMatch(/^const uint8_t PCA9685_ADDR = 0x40;\s+\/\/ I2C address of the servo driver/m);
    const channels = constants.filter((c) => c.kind === "channel");
    expect(channels.map((c) => `${c.name}=${c.value}`)).toEqual([
      "SERVO_BASE=0",
      "SERVO_SHOULDER=1",
      "SERVO_ELBOW=2",
      "SERVO_WRIST_PITCH=3",
      "SERVO_WRIST_ROLL=4",
      "SERVO_GRIPPER=5",
    ]);
    expect(block).toMatch(/^const int SERVO_BASE\s+= 0;/m);
    for (const c of channels) expect(block).toContain(`(${c.connectionIds[0]})`);
    // The board's own pins are only the I2C pair.
    expect(constants.filter((c) => !c.kind || c.kind === "pin").map((c) => c.name).sort()).toEqual(["I2C_SCL_PIN", "I2C_SDA_PIN"]);
  });

  it("no roles → SERVO_1…; the block is re-inserted unchanged; declarations link to wires", () => {
    const w = buildWiring(robotArmComponents(), ROBOT_ARM_SPEC, getPart, "en");
    const constants = pinConstants(buildConnections(w.components, w.netlist.nets, getPart), getPart);
    expect(constants.filter((c) => c.kind === "channel").map((c) => c.name)).toEqual(["SERVO_1", "SERVO_2", "SERVO_3", "SERVO_4", "SERVO_5", "SERVO_6"]);
    const block = pinBlock(constants);
    const code = `#include <Adafruit_PWMServoDriver.h>\n\n${block}\n\nvoid loop() { pwm.setPWM(SERVO_3, 0, 300); }\n`;
    expect(replacePinBlock(code, block).changed).toBe(false);
    const links = lineLinks(code, constants);
    const decl = [...links.values()].find((l) => l.name === "PCA9685_ADDR");
    expect(decl?.declares).toBe(true);
    expect([...links.values()].some((l) => l.name === "SERVO_3" && !l.declares)).toBe(true);
  });
});

describe("Try it: joints", () => {
  const sim = (ids: readonly string[], spec: ProductSpec) => {
    const { w } = arm(ids, spec);
    return simModel({ spec, components: w.components }, getPart);
  };

  it("one slider per servo (≤ 6), named; nothing else drives them", () => {
    const model = sim(ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC);
    const joints = model.controls.filter((c) => c.kind === "joint");
    expect(joints).toHaveLength(6);
    expect(joints.length).toBeLessThanOrEqual(JOINT_SLIDERS_MAX);
    expect(joints.map((j) => j.name?.en)).toEqual(["Servo 1 — base", "Servo 2 — shoulder", "Servo 3 — elbow", "Servo 4 — wrist pitch", "Servo 5 — wrist roll", "Servo 6 — gripper"]);
    expect(joints.every((j) => j.type === "slider" && j.min === 0 && j.max === 180)).toBe(true);
    expect(model.primary).toBeNull();
    expect(model.controls.some((c) => c.kind === "power")).toBe(false);
  });

  it("a joint turns to its slider and holds; the others stay put", () => {
    const model = sim(ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC);
    const inputs = initialInputs(model);
    let s = initialState(model, inputs);
    expect(s.cause).toBe("jointStill");
    expect(outputsAttr(s)).toBe(Array(6).fill("servo:90").join(","));
    const base = model.controls.find((c) => c.kind === "joint" && c.n === 1)!;
    const moved = { ...inputs, values: { ...inputs.values, [base.id]: 30 } };
    s = step(model, s, moved, SIM_DT);
    expect(s.cause).toBe("jointMoving");
    for (let i = 0; i < 60; i++) s = step(model, s, moved, SIM_DT);
    expect(s.cause).toBe("jointStill");
    expect(s.outputs.find((o) => o.id === base.servo)!.angle).toBe(30);
    expect(s.outputs.filter((o) => o.id !== base.servo).every((o) => o.angle === 90)).toBe(true);
  });

  it("more than 6 servos → still one joint each (the panel shows a picker + one slider)", () => {
    const joints = sim(EIGHT, SPEC8).controls.filter((c) => c.kind === "joint");
    expect(joints).toHaveLength(8);
    expect(joints.length).toBeGreaterThan(JOINT_SLIDERS_MAX);
    expect(new Set(joints.map((j) => j.name?.en)).size).toBe(8);
  });
});

describe("drawings and the 3D build", () => {
  it.each([
    ["6 servos", ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC],
    ["8 servos", EIGHT, SPEC8],
  ] as const)("%s: one name per part, no open driver pins drawn, strands drawn under the plug's id", (_n, ids, spec) => {
    const { w, connections } = arm(ids, spec);
    for (const render of [renderWiringSVG, renderSchematicSVG]) {
      const svg = render(w.components, w.netlist.nets, getPart, { locale: "en", connections });
      const names = [...instanceNames(connections, "en").values()];
      for (const n of names) expect(svg.split(`>${n}</text>`).length - 1, n).toBe(1);
      expect(svg).not.toContain("pca9685_servo_1.CH15_PWM");
    }
    const svg = renderWiringSVG(w.components, w.netlist.nets, getPart, { locale: "en", connections });
    for (const c of connections.filter((x) => x.bundle)) {
      expect(svg).toContain(`class="wire-strand" data-conn="${c.id}" data-colour="red"`);
      expect(svg).toContain(`class="wire-strand" data-conn="${c.id}" data-colour="black"`);
    }
  });

  it.each([
    ["6 servos", ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC],
    ["8 servos", EIGHT, SPEC8],
  ] as const)("%s: servos and the driver on the mat, driver beside the board, every route found", (_n, ids, spec) => {
    const { w, connections, nets } = arm(ids, spec);
    const items = w.components.map((c) => ({ instanceId: c.instanceId, part: getPart(c.partId)! }));
    const layout = layoutMat(items, connections, nets);
    const servos = layout.placements.filter((p) => /servo/.test(p.partId));
    expect(servos.every((p) => !p.breadboard)).toBe(true);
    const drv = layout.placements.find((p) => p.partId === "pca9685_servo")!;
    const board = layout.placements.find((p) => p.board)!;
    // Beside (above) the board + breadboard, the servos in a row beyond it in channel order.
    expect(drv.pos[1]).toBeGreaterThan(board.pos[1]);
    const row = servos.filter((p) => p.partId !== "pca9685_servo");
    expect(row.every((p) => p.pos[1] > drv.pos[1])).toBe(true);
    const xs = connections.filter((c) => c.bundle).map((c) => layout.placements.find((p) => p.instanceId === c.to.part)!.pos[0]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // No two footprints overlap.
    const ps = layout.placements;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const [a, b] = [ps[i], ps[j]];
        const apart = Math.abs(a.pos[0] - b.pos[0]) * 2 >= a.w + b.w || Math.abs(a.pos[1] - b.pos[1]) * 2 >= a.d + b.d;
        expect(apart, `${a.instanceId} / ${b.instanceId}`).toBe(true);
      }
    const plan = planWires({ connections, layout, getPart, nets });
    expect(plan.routes.filter((r) => !r.ok).map((r) => r.key)).toEqual([]);
  });

  it("pin names on the driver board never overlap", () => {
    for (const rot of [0, 90, 180, 270] as const) expect(overlappingLabels(pinLabelLayout(getPart("pca9685_servo")!, rot))).toEqual([]);
  });
});

describe("enclosure and Wokwi", () => {
  it("the case packs the board, the driver and the supply, not the arm's servos", () => {
    const items = robotArmComponents().map((c) => ({ instanceId: c.instanceId, part: getPart(c.partId)! }));
    expect(enclosedItems(items).map((i) => i.part.id)).toEqual(["esp32_devkit", "psu_5v_5a", "pca9685_servo"]);
    expect(layoutComponents(items).layout.map((l) => l.instanceId).sort()).toEqual(["esp32_devkit_1", "pca9685_servo_1", "psu_5v_5a_1"]);
    // Without a driver nothing changes (a feeder's servo stays in its case).
    const feeder = robotArmComponents(["esp32_devkit", "sg90_servo"]).map((c) => ({ instanceId: c.instanceId, part: getPart(c.partId)! }));
    expect(enclosedItems(feeder)).toEqual(feeder);
  });

  it("the Wokwi export can't map the servo driver: no button for these projects", () => {
    const { w, connections } = arm();
    const r = wokwiDiagram(w.components, connections as Connection[], w.netlist.nets, getPart);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unsupported).toContain("pca9685_servo");
  });
});
