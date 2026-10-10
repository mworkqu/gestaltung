import { describe, expect, it } from "vitest";

import { usagePriceQar } from "./usage-price";

describe("usagePriceQar", () => {
  it("charges the minimum when it cost us nothing", () => {
    expect(usagePriceQar(0)).toBe(20);
    expect(usagePriceQar(-1)).toBe(20);
    expect(usagePriceQar(Number.NaN)).toBe(20);
  });

  it("is 10x cost plus 12 %, rounded up to the next 10, never below 20", () => {
    expect(usagePriceQar(0.5)).toBe(20); // 5.60 -> 10 -> minimum 20
    expect(usagePriceQar(2)).toBe(30); // 22.40 -> 30
    expect(usagePriceQar(5)).toBe(60); // 56 -> 60
    expect(usagePriceQar(10)).toBe(120); // 112 -> 120
  });

  it("does not round up a whole step on an exact multiple", () => {
    expect(usagePriceQar(2.5)).toBe(30); // 28 -> 30
    expect(usagePriceQar(25 / 2.8)).toBe(100); // exactly 100
  });
});
