import { describe, expect, it } from "vitest";

import { landedCostQar, suggestedPriceQar } from "@/lib/sourcing/landed-cost";
import { round2 } from "@/lib/format/money";

const pricing = { usdToQar: 3.64, overheadPct: { mouser: 25, digikey: 30 }, markup: 40 };

describe("landedCostQar", () => {
  it("converts USD and adds the supplier's overhead", () => {
    expect(landedCostQar({ cost: 2.5, currency: "USD", supplierCode: "mouser" }, pricing)).toBe(11.38);
    expect(landedCostQar({ cost: 2.5, currency: "USD", supplierCode: "digikey" }, pricing)).toBe(11.83);
  });
  it("QAR costs are not converted", () => {
    expect(landedCostQar({ cost: 10, currency: "QAR", supplierCode: "mouser" }, pricing)).toBe(12.5);
  });
  it("an unknown supplier has no overhead; any non-QAR currency uses the USD rate", () => {
    expect(landedCostQar({ cost: 1, currency: "USD", supplierCode: "other" }, pricing)).toBe(3.64);
    expect(landedCostQar({ cost: 1, currency: "EUR", supplierCode: "other" }, pricing)).toBe(3.64);
  });
  it("no cost, no landed cost", () => {
    expect(landedCostQar({ cost: null, currency: "USD", supplierCode: "mouser" }, pricing)).toBeNull();
    expect(landedCostQar({ cost: 0, currency: "USD", supplierCode: "mouser" }, pricing)).toBe(0);
  });
});

describe("suggestedPriceQar", () => {
  it("adds the markup and rounds up to QAR 0.50", () => {
    expect(suggestedPriceQar(11.38, 40)).toBe(16);
    expect(suggestedPriceQar(10, 40)).toBe(14);
    expect(suggestedPriceQar(10.1, 40)).toBe(14.5);
    expect(suggestedPriceQar(11.83, 40)).toBe(17);
  });
  it("is never below QAR 1", () => {
    expect(suggestedPriceQar(0, 40)).toBe(1);
    expect(suggestedPriceQar(0.3, 40)).toBe(1);
  });
});

// The expression components/admin/supplier-lookup.tsx had inline before R6.
const before = (cost: number | null, currency: string, code: string) => {
  const landed = cost === null ? null : round2(cost * (currency === "QAR" ? 1 : pricing.usdToQar) * (1 + (pricing.overheadPct[code as keyof typeof pricing.overheadPct] ?? 0) / 100));
  return { landed, suggested: landed === null ? "" : String(Math.max(1, Math.ceil(landed * (1 + pricing.markup / 100) * 2) / 2)) };
};

describe("same numbers as the old inline formula", () => {
  it("over a grid of costs, currencies and suppliers", () => {
    for (const cost of [null, 0, 0.07, 0.5, 1, 2.5, 3.333, 9.99, 17.4, 250]) {
      for (const currency of ["USD", "QAR"]) {
        for (const supplierCode of ["mouser", "digikey", "x"]) {
          const landed = landedCostQar({ cost, currency, supplierCode }, pricing);
          const suggested = landed === null ? "" : String(suggestedPriceQar(landed, pricing.markup));
          expect({ landed, suggested }).toEqual(before(cost, currency, supplierCode));
        }
      }
    }
  });
});
