import { describe, expect, it } from "vitest";

import { MAX_REFINEMENTS, maxVisionCalls, visionBudget } from "./vision-budget";

describe("visionBudget", () => {
  it("hands out its loops once and then refuses", () => {
    const b = visionBudget(2);
    expect(b.left).toBe(2);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.left).toBe(0);
    expect(b.take()).toBe(false);
    expect(b.left).toBe(0);
  });

  it("is shared, so one design cannot be refined three times and leave none for the others", () => {
    const b = visionBudget();
    const spent = [b.take(), b.take(), b.take()];
    expect(spent).toEqual([true, true, false]);
  });

  it("takes nothing when there is no pool", () => {
    for (const n of [0, -1, -7]) {
      const b = visionBudget(n);
      expect(b.left).toBe(0);
      expect(b.take()).toBe(false);
    }
  });

  it("three designs cost at most one check each plus the shared pool", () => {
    expect(MAX_REFINEMENTS).toBe(2);
    expect(maxVisionCalls(3)).toBe(5);
    expect(maxVisionCalls(1)).toBe(3);
    // Nine was the old per-design cap: 3 designs x (1 + 2).
    expect(maxVisionCalls(3)).toBeLessThan(9);
  });
});
