import { describe, expect, it } from "vitest";

import { canRequestItem, showMinOrder } from "@/lib/store/product-display";

describe("showMinOrder", () => {
  it("shows only when the minimum is above 1", () => {
    expect(showMinOrder(2)).toBe(true);
    expect(showMinOrder(10)).toBe(true);
    expect(showMinOrder(1)).toBe(false);
    expect(showMinOrder(0)).toBe(false);
    expect(showMinOrder(null)).toBe(false);
    expect(showMinOrder(undefined)).toBe(false);
    expect(showMinOrder(Number.NaN)).toBe(false);
  });
});

describe("canRequestItem", () => {
  it("is for products on request (no lead-time class) only", () => {
    expect(canRequestItem(null)).toBe(true);
    expect(canRequestItem(undefined)).toBe(true);
    expect(canRequestItem("in_stock")).toBe(false);
    expect(canRequestItem("2_4_weeks")).toBe(false);
  });
});
