import { describe, expect, it } from "vitest";

import { cleanWeights, DEFAULT_WEIGHTS, demandScore, draftCsv, estimatedUnits, groupDraft, orderQty, type RestockRow } from "./restock";

const row = (over: Partial<RestockRow>): RestockRow => ({
  partId: "p",
  sku: "GR-1",
  name: "Servo",
  counts: { views: 0, carts: 0, requests: 0, requestedQty: 0 },
  score: 0,
  price: 20,
  landedCost: 10,
  income: 10,
  incomePct: 50,
  leadTimeClass: "in_stock",
  supplier: { id: "s1", name: "Voltaat", minOrderValue: 100 },
  supplierSku: "VT-1",
  supplierUrl: null,
  moq: 1,
  units: 0,
  estRevenue: 0,
  ...over,
});

describe("scoring", () => {
  it("uses the default weights: request 10, cart 5, view 1", () => {
    expect(demandScore({ views: 7, carts: 2, requests: 1, requestedQty: 5 }, DEFAULT_WEIGHTS)).toBe(27);
  });
  it("counts requested quantities and carts as units, not views", () => {
    expect(estimatedUnits({ views: 50, carts: 2, requests: 1, requestedQty: 5 })).toBe(7);
  });
  it("keeps valid custom weights and falls back per field", () => {
    expect(cleanWeights({ request: 20, view: -1, add_to_cart: "x" })).toEqual({ request: 20, bom_unmatched: 8, add_to_cart: 5, view: 1 });
  });
  it("orders at least the minimum order quantity", () => {
    expect(orderQty({ units: 3, moq: 10 })).toBe(10);
    expect(orderQty({ units: 0, moq: 1 })).toBe(1);
  });
});

describe("draft order", () => {
  const groups = groupDraft([
    { row: row({ partId: "a", sku: "GR-1" }), qty: 4 },
    { row: row({ partId: "b", sku: "GR-2", landedCost: null }), qty: 2 },
    { row: row({ partId: "c", sku: "GR-3", supplier: { id: "s2", name: "Mouser", minOrderValue: null }, landedCost: 3.5 }), qty: 10 },
  ]);
  it("groups by supplier with totals against the minimum order value", () => {
    expect(groups.map((g) => [g.supplierName, g.total, g.unpriced, g.belowMinimum])).toEqual([
      ["Voltaat", 40, 1, true],
      ["Mouser", 35, 0, false],
    ]);
  });
  it("exports a CSV with one line per product", () => {
    const csv = draftCsv(groups).trim().split("\n");
    expect(csv).toHaveLength(4);
    expect(csv[1]).toBe("Voltaat,VT-1,GR-1,Servo,4,10,40,1,,0");
  });
});
