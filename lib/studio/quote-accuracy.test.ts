import { describe, expect, it } from "vitest";

import { MIN_QUOTES, quoteAccuracy, quotedRows, type QuotedRow } from "./quote-accuracy";
import { DEFAULT_QUOTE_RULE, rangeFor } from "./request-summary";

/** A quoted request whose estimate came from `grams` printed + `parts` QAR with the default rule. */
function row(finalQar: number, grams: number, parts = 0): QuotedRow {
  const subtotal = DEFAULT_QUOTE_RULE.base_qar + DEFAULT_QUOTE_RULE.per_gram_qar * grams + parts;
  const r = rangeFor(subtotal, DEFAULT_QUOTE_RULE.spread)!;
  return { finalQar, calc: { low: r.low, high: r.high, midpoint: (r.low + r.high) / 2, parts_qar: parts, printed_grams: grams } };
}

describe("quoteAccuracy", () => {
  it("averages final ÷ midpoint and final ÷ low, and counts where quotes fall", () => {
    // 100 g → subtotal 170 → 170–300, mid 235
    const a = quoteAccuracy([row(235, 100), row(470, 100), row(100, 100)], DEFAULT_QUOTE_RULE);
    expect(a.count).toBe(3);
    expect(a.avgFinalOverMid).toBeCloseTo((1 + 2 + 100 / 235) / 3, 2);
    expect(a.avgFinalOverLow).toBeCloseTo((235 / 170 + 470 / 170 + 100 / 170) / 3, 2);
    expect([a.inside, a.above, a.below]).toEqual([1, 1, 1]);
  });

  it("needs MIN_QUOTES quotes before it suggests anything", () => {
    const a = quoteAccuracy([row(300, 100)], DEFAULT_QUOTE_RULE);
    expect(a.suggestion).toEqual({ kind: "too_few", needed: MIN_QUOTES - 1 });
    expect(quoteAccuracy([], DEFAULT_QUOTE_RULE)).toMatchObject({ count: 0, avgFinalOverMid: null, suggestion: { kind: "too_few", needed: MIN_QUOTES } });
  });

  it("says no change when quotes sit on the middle of the range", () => {
    const a = quoteAccuracy([row(235, 100), row(240, 100), row(232, 100)], DEFAULT_QUOTE_RULE);
    expect(a.suggestion.kind).toBe("on_target");
  });

  it("suggests the rate per gram that centres the range on the quotes", () => {
    // Every quote ~18 % above a mid of 235 → 277.3
    const a = quoteAccuracy([row(277.3, 100), row(277.3, 100), row(277.3, 100)], DEFAULT_QUOTE_RULE);
    expect(a.pctVsMid).toBeCloseTo(18, 0);
    expect(a.suggestion.kind).toBe("raise");
    if (a.suggestion.kind !== "raise") throw new Error("expected raise");
    // target subtotal = 277.3 × 2 / 2.5 = 221.84 → (221.84 − 100) / 100 g = 1.22
    expect(a.suggestion.perGramQar).toBeCloseTo(1.22, 2);
    expect(a.suggestion.pct).toBeCloseTo(18, 0);
  });

  it("suggests lowering when quotes are well below, never below zero", () => {
    const a = quoteAccuracy([row(150, 200), row(160, 200), row(155, 200)], DEFAULT_QUOTE_RULE);
    expect(a.suggestion.kind).toBe("lower");
    if (a.suggestion.kind === "lower") {
      expect(a.suggestion.perGramQar).toBeGreaterThanOrEqual(0);
      expect(a.suggestion.perGramQar).toBeLessThan(DEFAULT_QUOTE_RULE.per_gram_qar);
    }
  });

  it("cannot tune the rate from requests with no printed grams", () => {
    const a = quoteAccuracy([row(300, 0), row(300, 0), row(300, 0)], DEFAULT_QUOTE_RULE);
    expect(a.suggestion.kind).toBe("no_grams");
  });

  it("ignores rows with no estimate or a junk final price", () => {
    const bad: QuotedRow = { finalQar: Number.NaN, calc: { low: null, high: null, midpoint: null, parts_qar: 0, printed_grams: 0 } };
    expect(quoteAccuracy([bad, row(0, 10)], DEFAULT_QUOTE_RULE).count).toBe(0);
  });
});

describe("quotedRows", () => {
  const calc = { base_qar: 100, per_gram_qar: 0.7, spread: 1.5, subtotal_qar: 170, low: 170, high: 300, midpoint: 235, printed: [], components: [] };
  it("keeps quoted rows with a calculation and drops test rows", () => {
    const rows = quotedRows([
      { id: "a1b2c3d4-0000-4000-8000-000000000001", name: "Sara", message: "Design Studio: Lamp", quote_calc: calc, final_quote_qar: "260.00" },
      { id: "a1b2c3d4-0000-4000-8000-000000000002", name: "TEST lead", message: "x", quote_calc: calc, final_quote_qar: 260 },
      { id: "a1b2c3d4-0000-4000-8000-000000000003", name: "Ali", message: "x", is_test: true, quote_calc: calc, final_quote_qar: 260 },
      { id: "2f1e6ed7-0000-4000-8000-000000000004", name: "Old", message: "x", quote_calc: calc, final_quote_qar: 260 },
      { id: "a1b2c3d4-0000-4000-8000-000000000005", name: "Not quoted", message: "x", quote_calc: calc, final_quote_qar: null },
      { id: "a1b2c3d4-0000-4000-8000-000000000006", name: "No calc", message: "x", quote_calc: null, final_quote_qar: 99 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].finalQar).toBe(260);
    expect(rows[0].calc.midpoint).toBe(235);
  });
});
