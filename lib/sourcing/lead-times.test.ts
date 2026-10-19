import { describe, expect, it } from "vitest";

import { SUPPLIER_LEAD_DAYS, supplierLeadDays, supplierRank } from "@/lib/sourcing/lead-times";

// The owner's running order and delivery promise (2026-10-19): our own shelf
// first and next day, then Voltaat in 2 days, then DigiKey and Mouser in 2
// weeks. These tests pin both, and pin the lead-class band each number lands
// in, because 0028 derives the customer-facing wording from the day count.

describe("supplierRank", () => {
  it("offers our own stock first, then Voltaat, then DigiKey, then Mouser", () => {
    const order = ["own_stock", "voltaat", "digikey", "mouser"];
    const ranks = order.map(supplierRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
  });

  it("puts the marketplaces last and an unknown supplier in between", () => {
    expect(supplierRank("alibaba")).toBeGreaterThan(supplierRank("mouser"));
    expect(supplierRank("someone-new")).toBeGreaterThan(supplierRank("mouser"));
    expect(supplierRank("someone-new")).toBeLessThan(supplierRank("aliexpress"));
  });

  it("ignores case and treats a missing code as unknown", () => {
    expect(supplierRank("VoltAat")).toBe(supplierRank("voltaat"));
    expect(supplierRank(null)).toBe(supplierRank(undefined));
  });
});

describe("supplierLeadDays", () => {
  it("is next day for our shelf, 2 days for Voltaat, 2 weeks for the US suppliers", () => {
    expect(supplierLeadDays("own_stock")).toBe(1);
    expect(supplierLeadDays("voltaat")).toBe(2);
    expect(supplierLeadDays("digikey")).toBe(14);
    expect(supplierLeadDays("mouser")).toBe(14);
  });

  it("is null for a supplier we have no rule for", () => {
    expect(supplierLeadDays("alibaba")).toBeNull();
    expect(supplierLeadDays("")).toBeNull();
  });

  // 0028: <= 2 days is "In stock", <= 5 is "3-5 days", <= 14 is "1-2 weeks".
  it("keeps each supplier inside the lead class the customer should see", () => {
    expect(SUPPLIER_LEAD_DAYS.own_stock).toBeLessThanOrEqual(2);
    expect(SUPPLIER_LEAD_DAYS.voltaat).toBeLessThanOrEqual(2);
    expect(SUPPLIER_LEAD_DAYS.digikey).toBeGreaterThan(5);
    expect(SUPPLIER_LEAD_DAYS.digikey).toBeLessThanOrEqual(14);
    expect(SUPPLIER_LEAD_DAYS.mouser).toBeLessThanOrEqual(14);
  });
});
