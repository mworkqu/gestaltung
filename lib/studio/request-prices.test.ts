import { describe, expect, it } from "vitest";

import { pricesBySku } from "./request-prices";
import { quoteBreakdown } from "./request-summary";
import type { StudioDoc } from "./schema";

describe("pricesBySku (F-044)", () => {
  it("keeps only usable listed prices, keyed by SKU", () => {
    const m = new Map([
      ["A", { sku: "A", unit_price: 12.5 }],
      ["B", { sku: "B", unit_price: 0 }],
      ["C", { sku: "C", unit_price: null }],
    ]);
    expect([...pricesBySku(m)]).toEqual([["A", 12.5]]);
  });
  it("feeds the single quote calculation: no parts still gives the print base range", () => {
    const b = quoteBreakdown({ doc: { components: [], mech: [] } as unknown as StudioDoc, getPart: () => undefined, prices: pricesBySku(new Map()) });
    expect(b.partsQar).toBe(0);
  });
});
