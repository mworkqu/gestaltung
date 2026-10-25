import { describe, expect, it } from "vitest";

import { clampScope, clampSpec, clampUnderstanding, type BuildScope, type ProductSpec } from "./schema";
import { syncMovers } from "./ai/spec";
import {
  IDEATION,
  TIERS,
  chargePlan,
  chargeTier,
  classify,
  countParts,
  escalationCost,
  regenCost,
  tierOf,
  turnsUntilCharge,
} from "./tiers";
import { callCostUsd } from "../ai/prices";

const base = clampSpec({ name: "Plant buddy", oneLine: "Waters a plant", quantity: 1 });
const withU = (u: unknown, scope?: BuildScope): ProductSpec => ({
  ...base,
  understanding: clampUnderstanding(u),
  ...(scope ? { scope } : {}),
});

const understanding = (sensors: number, servos: number, linear = 0) => ({
  goal: "Water the plant when the soil is dry",
  howItWorks: "A sensor reads the soil; the board opens the valve.",
  controller: "Arduino Uno",
  sensors: sensors ? [{ name: "Soil moisture sensor", count: sensors }] : [],
  actuators: [
    ...(servos ? [{ name: "SG90 servo", count: servos, kind: "servo" }] : []),
    ...(linear ? [{ name: "Small linear actuator", count: linear, kind: "linear actuator" }] : []),
  ],
  outputs: [{ name: "LED", count: 3 }],
});

/** A Tier 1 card: one controller, 2 sensors, 2 movers, nothing in the scope. */
const tier1 = () => withU(understanding(2, 2), { controllers: 1 });

describe("the three tiers", () => {
  it("prices Tier 1 free, Tier 2 at 7 and Tier 3 at 14 tokens", () => {
    expect(TIERS.map((t) => [t.level, t.id, t.upfront])).toEqual([
      [1, "explorer", 0],
      [2, "maker", 7],
      [3, "engineer", 14],
    ]);
  });

  it("Tier 1: one controller, at most 2 sensors and 2 movers", () => {
    expect(tierOf(tier1()).level).toBe(1);
    expect(tierOf(withU(understanding(1, 1, 1))).level).toBe(1);
    // Outputs (LEDs, buzzers, screens) never count.
    expect(countParts(withU(understanding(2, 1, 1)))).toEqual({ controllers: 1, sensors: 2, movers: 2, outputs: 3 });
  });

  it("boundary: exactly 2 sensors is Tier 1, a 3rd is Tier 2 (dropped from 3 on 2026-10-25)", () => {
    expect(classify(withU(understanding(2, 0)))).toMatchObject({ tier: { level: 1 }, reasons: [] });
    const three = classify(withU(understanding(3, 0)));
    expect(three.tier.level).toBe(2);
    expect(three.reasons).toEqual(["sensors"]);
  });

  it("boundary: exactly 2 movers is Tier 1, a 3rd is Tier 2", () => {
    expect(tierOf(withU(understanding(1, 2))).level).toBe(1);
    expect(classify(withU(understanding(1, 3)))).toMatchObject({ tier: { level: 2 }, reasons: ["movers"] });
  });

  it("boundary: 1 controller is Tier 1, 2 controllers are Tier 2", () => {
    expect(tierOf(withU(understanding(1, 1), { controllers: 1 })).level).toBe(1);
    expect(classify(withU(understanding(1, 1), { controllers: 2 }))).toMatchObject({
      tier: { level: 2 },
      reasons: ["controllers"],
    });
  });

  it("a bus between controllers is Tier 2; an I2C sensor on one board is not", () => {
    expect(classify(withU(understanding(1, 1), { controllers: 2, controllerBus: "can" })).reasons).toEqual([
      "controllers",
      "controller_bus",
    ]);
    // The scope field is only ever set for controller-to-controller traffic, so a
    // single-board build with an I2C sensor simply has no bus and stays Tier 1.
    expect(tierOf(withU(understanding(2, 0), { controllers: 1 })).level).toBe(1);
  });

  it("boundary: a 4-axis machine is Tier 2; a 2-axis pan-tilt head is not", () => {
    const fourAxis = classify(withU(understanding(1, 1), { controllers: 1, axes: 4 }));
    expect(fourAxis.tier.id).toBe("maker");
    expect(fourAxis.reasons).toContain("axes");
    expect(tierOf(withU(understanding(1, 2), { controllers: 1, axes: 2 })).level).toBe(1);
  });

  it("a higher-end controller is Tier 2 on its own", () => {
    expect(classify(withU(understanding(1, 0), { controllers: 1, highEndController: true }))).toMatchObject({
      tier: { id: "maker" },
      reasons: ["high_end_controller"],
    });
  });

  it("boundary: a custom PCB is Tier 3, even on a two-part build", () => {
    const pcb = classify(withU(understanding(1, 0), { controllers: 1, customPcb: true }));
    expect(pcb.tier.level).toBe(3);
    expect(pcb.tier.upfront).toBe(14);
    expect(pcb.reasons).toEqual(["custom_pcb"]);
  });

  it("production firmware, an integrated package and complex power are Tier 3", () => {
    for (const [field, reason] of [
      ["productionFirmware", "production_firmware"],
      ["integratedEnclosure", "integrated_enclosure"],
      ["complexPower", "complex_power"],
    ] as const) {
      const c = classify(withU(understanding(1, 0), { controllers: 1, [field]: true }));
      expect(c.tier.id).toBe("engineer");
      expect(c.reasons).toContain(reason);
    }
  });

  it("a big build with no integration signal stays Tier 2, however many parts", () => {
    // Owner decision 2026-10-25: Tier 3 is about integration, not part count. If this
    // test ever fails, someone has started pricing big builds as turnkey ones.
    const big = classify(withU(understanding(6, 4), { controllers: 3, controllerBus: "can", axes: 6, highEndController: true }));
    expect(big.tier.level).toBe(2);
    expect(big.tier.upfront).toBe(7);
    expect(big.reasons).not.toContain("custom_pcb");
  });

  it("Tier 3 keeps the Tier 2 reasons too, so the modal can explain all of it", () => {
    const c = classify(withU(understanding(5, 4), { controllers: 3, customPcb: true }));
    expect(c.tier.level).toBe(3);
    expect(c.reasons).toEqual(["custom_pcb", "sensors", "movers", "controllers"]);
  });

  it("no card, no scope and a scope-less old card are all Tier 1", () => {
    expect(tierOf(null).level).toBe(1);
    expect(tierOf(undefined).level).toBe(1);
    expect(tierOf(base).level).toBe(1);
    expect(classify(withU(understanding(1, 1))).reasons).toEqual([]);
  });

  it("a card without an understanding counts spec.actuators", () => {
    const spec = clampSpec({ ...base, actuators: [{ kind: "servo", count: 4, load: "light" }] });
    expect(tierOf(spec).id).toBe("maker");
  });
});

describe("escalationCost", () => {
  it("an idea's price is its tier's price, however it was reached", () => {
    expect(escalationCost("explorer", "maker")).toBe(7);
    expect(escalationCost("maker", "engineer")).toBe(7);
    expect(escalationCost("explorer", "engineer")).toBe(14);
    expect(escalationCost("explorer", "maker") + escalationCost("maker", "engineer")).toBe(
      escalationCost("explorer", "engineer"),
    );
  });
  it("never charges for standing still or for a lower tier", () => {
    expect(escalationCost("maker", "maker")).toBe(0);
    expect(escalationCost("engineer", "explorer")).toBe(0);
  });
});

describe("chargePlan", () => {
  it("a new Tier 1 idea is free and starts the project at Tier 1", () => {
    const plan = chargePlan({ started: false, spec: tier1() });
    expect(plan).toMatchObject({ kind: "new_idea", amount: 0, needsApproval: false, tier: { id: "explorer" } });
  });

  it("a new idea that lands in Tier 2 pauses for approval of exactly 7 tokens", () => {
    const plan = chargePlan({ started: false, spec: withU(understanding(4, 0), { controllers: 1 }) });
    expect(plan).toMatchObject({ kind: "new_idea", amount: 7, needsApproval: true, tier: { id: "maker" } });
    expect(plan.reasons).toEqual(["sensors"]);
  });

  it("chat edits inside the stored tier are free", () => {
    const plan = chargePlan({ storedTier: "maker", started: true, spec: withU(understanding(4, 0), { controllers: 1 }) });
    expect(plan).toMatchObject({ kind: "none", amount: 0, needsApproval: false, tier: { id: "maker" } });
    expect(IDEATION.editCost).toBe(0);
  });

  it("an escalation pauses, then charges the agreed amount once approved", () => {
    const spec = withU(understanding(1, 1), { controllers: 1, customPcb: true });
    const paused = chargePlan({ storedTier: "explorer", started: true, spec });
    expect(paused).toMatchObject({ kind: "escalation", amount: 14, needsApproval: true, tier: { id: "engineer" } });
    const approved = chargePlan({ storedTier: "explorer", started: true, spec, approved: "engineer" });
    expect(approved).toMatchObject({ amount: 14, needsApproval: false });
  });

  it("an approval for a lower tier than the build needs pauses again", () => {
    const spec = withU(understanding(1, 1), { controllers: 1, customPcb: true });
    expect(chargePlan({ storedTier: "explorer", started: true, spec, approved: "maker" })).toMatchObject({
      amount: 14,
      needsApproval: true,
    });
  });

  it("idempotent: once the tier is stored, replaying the same approval charges nothing", () => {
    const spec = withU(understanding(4, 0), { controllers: 1 });
    expect(chargePlan({ storedTier: "maker", started: true, spec, approved: "maker" })).toMatchObject({
      kind: "none",
      amount: 0,
      needsApproval: false,
    });
  });

  it("admins are never charged and never see the checkpoint", () => {
    const spec = withU(understanding(1, 1), { controllers: 1, customPcb: true });
    expect(chargePlan({ storedTier: "explorer", started: true, spec, admin: true })).toMatchObject({
      amount: 0,
      needsApproval: false,
      tier: { id: "engineer" },
    });
  });

  it("AI-06: the stored tier is a floor, so a small card cannot buy a cheaper turn", () => {
    const small = tier1();
    // The project is stored as Engineers; the client claims a Tier 1 card.
    const plan = chargePlan({ storedTier: "engineer", started: true, spec: small });
    expect(plan.tier.id).toBe("engineer");
    expect(plan.amount).toBe(0); // nothing more to pay, and nothing refunded
    expect(chargeTier("engineer", small).id).toBe("engineer");
    expect(chargeTier(null, null).id).toBe("explorer");
    expect(chargeTier("bogus", null).id).toBe("explorer");
  });

  it("an approveTier from the browser can only allow, never price", () => {
    // "I approve Engineers" on a Tier 1 build still charges nothing and stays Tier 1.
    const plan = chargePlan({ storedTier: "explorer", started: true, spec: tier1(), approved: "engineer" });
    expect(plan).toMatchObject({ tier: { id: "explorer" }, amount: 0, kind: "none" });
  });
});

describe("clampScope", () => {
  it("keeps only real signals and defaults the controller count to one", () => {
    expect(clampScope({ controllers: 1 })).toEqual({ controllers: 1 });
    expect(clampScope({ customPcb: true })).toEqual({ controllers: 1, customPcb: true });
    expect(clampScope({ controllers: 2, highEndController: false, axes: 0 })).toEqual({ controllers: 2, axes: 0 });
  });
  it("clamps counts, drops junk and never throws", () => {
    const log: { path: string; from: unknown; to: unknown }[] = [];
    expect(clampScope({ controllers: 99, axes: -4, controllerBus: "USB", customPcb: "yes" }, log)).toEqual({
      controllers: 8,
      axes: 0,
    });
    expect(log.map((l) => l.path).sort()).toEqual([
      "scope.axes",
      "scope.controllerBus",
      "scope.controllers",
      "scope.customPcb",
    ]);
    expect(clampScope("nope")).toBeUndefined();
    expect(clampScope({})).toBeUndefined();
    expect(clampScope(undefined)).toBeUndefined();
  });
  it("normalises the bus and survives clampSpec", () => {
    expect(clampScope({ controllers: 2, controllerBus: " I2C " })).toEqual({ controllers: 2, controllerBus: "i2c" });
    const spec = clampSpec({ ...base, scope: { controllers: 2, controllerBus: "spi" } });
    expect(spec.scope).toEqual({ controllers: 2, controllerBus: "spi" });
    expect(tierOf(spec).id).toBe("maker");
  });
  it("writes its keys in a fixed order, so an equal scope stringifies the same way", () => {
    const a = clampScope({ customPcb: true, controllers: 2, axes: 3 });
    const b = clampScope({ axes: 3, controllers: 2, customPcb: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the extras that are still charged per use", () => {
  it("the first 3D redesign is free, later ones cost 1 × tier", () => {
    const maker = withU(understanding(4, 0), { controllers: 1 });
    expect(regenCost(0, maker)).toBe(0);
    expect(regenCost(1, tier1())).toBe(1);
    expect(regenCost(1, maker)).toBe(2);
    expect(regenCost(3, withU(understanding(1, 0), { controllers: 1, customPcb: true }))).toBe(3);
  });
  it("turnsUntilCharge is only the legacy counter the balance line reads", () => {
    const n = IDEATION.turnsPerToken;
    expect(turnsUntilCharge(0)).toBe(n);
    expect(turnsUntilCharge(n - 1)).toBe(1);
    expect(turnsUntilCharge(n)).toBe(n);
  });
});

describe("understanding", () => {
  it("clamps model JSON: counts, kinds, empty parts dropped", () => {
    const u = clampUnderstanding({
      goal: "  Sort  bricks ",
      howItWorks: "x",
      controller: "ESP32",
      sensors: [{ name: "Colour sensor", count: 99 }, { name: "" }, "junk"],
      actuators: [{ name: "Linear actuator", count: 1, kind: "linear" }, { name: "Gripper", count: 0, kind: "??" }],
      outputs: [],
    });
    expect(u?.goal).toBe("Sort bricks");
    expect(u?.sensors).toEqual([{ name: "Colour sensor", count: 8 }]);
    expect(u?.actuators.map((a) => [a.kind, a.count])).toEqual([["linear_actuator", 1], ["servo", 1]]);
    expect(clampUnderstanding("nope")).toBeUndefined();
    expect(clampUnderstanding({})).toBeUndefined();
  });
  it("survives clampSpec and the zod schema", () => {
    const spec = clampSpec({ ...base, understanding: understanding(1, 2) });
    expect(spec.understanding?.controller).toBe("Arduino Uno");
  });
  it("syncMovers makes spec.actuators follow the understanding", () => {
    const four = syncMovers(withU(understanding(1, 4)));
    expect(four.actuators?.reduce((s, a) => s + a.count, 0)).toBe(4);
    const none = syncMovers({ ...withU(understanding(1, 0)), actuators: [{ kind: "servo", count: 2, load: "light" }] });
    expect(none.actuators).toBeUndefined();
    // Linear actuators stay in the understanding only.
    expect(syncMovers(withU(understanding(1, 0, 2))).actuators).toBeUndefined();
  });
});

describe("callCostUsd", () => {
  it("prices flash-lite input + output (thinking counts as output)", () => {
    expect(callCostUsd({ model: "gemini-3.5-flash-lite", promptTokens: 1_000_000, completionTokens: 0 })).toBeCloseTo(0.1);
    expect(callCostUsd({ model: "gemini-3.5-flash-lite", promptTokens: 1000, completionTokens: 100, totalTokens: 1500 })).toBeCloseTo(
      (1000 * 0.1 + 500 * 0.4) / 1e6,
    );
  });
  it("unknown model → null", () => {
    expect(callCostUsd({ model: "mystery", promptTokens: 10 })).toBeNull();
  });
});
