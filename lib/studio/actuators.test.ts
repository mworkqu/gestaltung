import { describe, expect, it } from "vitest";

import { actuatorCountIn, actuatorCountLabel, actuatorTotals, capStrongServos, setActuatorCount, STRONG_SERVO_MAX } from "./actuators";
import type { Actuator } from "./schema";

const arm: Actuator[] = [
  { kind: "servo", count: 3, load: "heavy", role: "base, shoulder, elbow" },
  { kind: "servo", count: 3, load: "light", role: "wrist, gripper" },
];

describe("actuatorTotals", () => {
  it("sums groups per kind", () => {
    expect(actuatorTotals({ actuators: arm })).toEqual([{ kind: "servo", count: 6 }]);
    expect(actuatorTotals({ actuators: [{ kind: "pump", count: 2, load: "light" }, ...arm] })).toEqual([
      { kind: "servo", count: 6 },
      { kind: "pump", count: 2 },
    ]);
    expect(actuatorTotals({})).toEqual([]);
  });
});

describe("setActuatorCount", () => {
  it("grows and shrinks the last group of the kind (the light end of an arm)", () => {
    expect(setActuatorCount({ actuators: arm }, "servo", 7).actuators?.map((a) => a.count)).toEqual([3, 4]);
    expect(setActuatorCount({ actuators: arm }, "servo", 4).actuators?.map((a) => a.count)).toEqual([3, 1]);
    expect(setActuatorCount({ actuators: arm }, "servo", 2).actuators).toEqual([{ ...arm[0], count: 2 }]);
  });

  it("clamps to 1..8 and returns the same object when nothing changes", () => {
    const spec = { actuators: arm };
    expect(setActuatorCount(spec, "servo", 6)).toBe(spec);
    expect(actuatorTotals(setActuatorCount(spec, "servo", 99))).toEqual([{ kind: "servo", count: 8 }]);
    expect(actuatorTotals(setActuatorCount(spec, "servo", 0))).toEqual([{ kind: "servo", count: 1 }]);
  });

  it("adds a medium group for a new kind", () => {
    expect(setActuatorCount({} as { actuators?: Actuator[] }, "pump", 2).actuators).toEqual([{ kind: "pump", count: 2, load: "medium" }]);
  });
});

describe("actuatorCountIn", () => {
  it.each([
    ["make it 4 joints", { kind: "servo", count: 4 }],
    ["a 6-axis arm", { kind: "servo", count: 6 }],
    ["use 2 pumps", { kind: "pump", count: 2 }],
    ["2 wheels please", { kind: "motor", count: 2 }],
    ["3 stepper motors", { kind: "stepper", count: 3 }],
    ["اجعلها ٤ مفاصل", { kind: "servo", count: 4 }],
    ["مضختين 2", null],
    ["make it 12 joints", null],
    ["a 5 V supply", null],
  ])("%s", (text, want) => {
    expect(actuatorCountIn(text)).toEqual(want);
  });
});

describe("actuatorCountLabel", () => {
  it("EN plural and AR count forms with Western digits", () => {
    expect(actuatorCountLabel("servo", 4, "en")).toBe("4 joints");
    expect(actuatorCountLabel("servo", 1, "en")).toBe("1 joint");
    expect(actuatorCountLabel("servo", 6, "ar")).toBe("6 مفاصل");
    expect(actuatorCountLabel("pump", 2, "ar")).toBe("مضختان");
  });
});

describe("capStrongServos (Part F: at most 3 strong servos on the 5 A supply)", () => {
  const spec = (actuators: Actuator[]) => ({ actuators });

  it("keeps an arm that already fits (3 heavy + 3 light) as the same object", () => {
    const arm = spec([
      { kind: "servo", count: 3, load: "heavy", role: "base, shoulder, elbow" },
      { kind: "servo", count: 3, load: "light", role: "wrist, gripper" },
    ]);
    expect(capStrongServos(arm)).toBe(arm);
    expect(STRONG_SERVO_MAX).toBe(3);
  });

  it("servo ×4 medium (what the real model gave 'robotic arm') → 3 medium + 1 light, same total", () => {
    const out = capStrongServos(spec([{ kind: "servo", count: 4, load: "medium", role: "joints and gripper" }]));
    expect(out.actuators).toEqual([
      { kind: "servo", count: 3, load: "medium", role: "joints and gripper" },
      { kind: "servo", count: 1, load: "light" },
    ]);
    expect(actuatorTotals(out)).toEqual([{ kind: "servo", count: 4 }]);
  });

  it("5 heavy + 1 light → 3 heavy + 3 light (extra joints join the existing light group)", () => {
    const out = capStrongServos(
      spec([
        { kind: "servo", count: 5, load: "heavy", role: "base" },
        { kind: "servo", count: 1, load: "light", role: "gripper" },
      ]),
    );
    expect(out.actuators).toEqual([
      { kind: "servo", count: 3, load: "heavy", role: "base" },
      { kind: "servo", count: 3, load: "light", role: "gripper" },
    ]);
  });

  it("leaves pumps and motors alone", () => {
    const s = spec([{ kind: "motor", count: 4, load: "heavy" }, { kind: "pump", count: 2, load: "medium" }]);
    expect(capStrongServos(s)).toBe(s);
  });
});
