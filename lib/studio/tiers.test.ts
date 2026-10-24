import { describe, expect, it } from "vitest";

import { clampSpec, clampUnderstanding, type ProductSpec } from "./schema";
import { syncMovers } from "./ai/spec";
import { IDEATION, chargeTier, countParts, tierOf, turnCost, turnsUntilCharge } from "./tiers";
import { callCostUsd } from "../ai/prices";

const base = clampSpec({ name: "Plant buddy", oneLine: "Waters a plant", quantity: 1 });
const withU = (u: unknown): ProductSpec => ({ ...base, understanding: clampUnderstanding(u) });

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

describe("tiers", () => {
  it("1 controller, 1–3 sensors, up to 2 movers is Explorers", () => {
    expect(tierOf(withU(understanding(3, 2))).id).toBe("explorer");
    expect(tierOf(withU(understanding(1, 1, 1))).id).toBe("explorer");
  });
  it("4 servos is Makers (×2); more is Engineers (×3)", () => {
    const four = tierOf(withU(understanding(1, 4)));
    expect(four.id).toBe("maker");
    expect(four.multiplier).toBe(2);
    expect(tierOf(withU(understanding(7, 2))).id).toBe("engineer");
    expect(tierOf(withU(understanding(1, 6))).multiplier).toBe(3);
  });
  it("outputs (LEDs, buzzer) do not count; linear actuators do", () => {
    const c = countParts(withU(understanding(2, 1, 1)));
    expect(c).toEqual({ controllers: 1, sensors: 2, movers: 2, outputs: 3 });
  });
  it("a card without an understanding counts spec.actuators", () => {
    const spec = clampSpec({ ...base, actuators: [{ kind: "servo", count: 4, load: "light" }] });
    expect(tierOf(spec).id).toBe("maker");
    expect(tierOf(null).id).toBe("explorer");
  });
});

describe("turnCost", () => {
  const n = IDEATION.turnsPerToken;
  it("a new idea costs 1 × tier", () => {
    expect(turnCost({ started: false, editTurnsSoFar: 0, current: null })).toMatchObject({ amount: 1, edit: false });
    expect(turnCost({ started: false, editTurnsSoFar: 0, current: withU(understanding(1, 4)) }).amount).toBe(2);
  });
  it("questions before the first card are part of the paid idea", () => {
    expect(turnCost({ started: true, editTurnsSoFar: 0, current: null }).amount).toBe(0);
  });
  it("edits: only every N-th turn costs, × tier", () => {
    const small = withU(understanding(1, 1));
    const costs = Array.from({ length: n * 2 }, (_, i) => turnCost({ started: true, editTurnsSoFar: i, current: small }).amount);
    expect(costs.filter((c) => c > 0)).toEqual([1, 1]);
    expect(costs[n - 1]).toBe(1);
    expect(turnCost({ started: true, editTurnsSoFar: n - 1, current: withU(understanding(1, 4)) }).amount).toBe(2);
  });
  it("AI-06: a low-tier card from the client cannot lower the server-stored tier", () => {
    const explorerCard = withU(understanding(1, 1));
    expect(tierOf(explorerCard).id).toBe("explorer");
    // Saved build is Engineers (×3); the client claims an Explorers card on the charging turn.
    const lie = turnCost({ started: true, editTurnsSoFar: n - 1, current: explorerCard, storedTier: "engineer" });
    expect(lie.tier.id).toBe("engineer");
    expect(lie.amount).toBe(3);
    // A new idea on a project with a stored Makers tier is not cheaper with a fake small card.
    expect(turnCost({ started: false, editTurnsSoFar: 0, current: explorerCard, storedTier: "maker" }).amount).toBe(2);
  });
  it("AI-06: honest clients pay what they paid before (card tier ≥ stored tier)", () => {
    const makerCard = withU(understanding(1, 4));
    expect(turnCost({ started: true, editTurnsSoFar: n - 1, current: makerCard, storedTier: "maker" }).amount).toBe(2);
    expect(turnCost({ started: true, editTurnsSoFar: n - 1, current: makerCard, storedTier: "explorer" }).amount).toBe(2);
    expect(turnCost({ started: false, editTurnsSoFar: 0, current: null, storedTier: "explorer" }).amount).toBe(1);
    expect(chargeTier(null, null).id).toBe("explorer");
    expect(chargeTier("bogus", null).id).toBe("explorer");
  });
  it("turnsUntilCharge counts down to the charging turn", () => {
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
