// W2b (2026-10-11): "Quote accuracy" — how the owner's real quotes compare with
// the Studio estimate, and a plain suggestion for the rate per gram. Pure: the
// admin page reads the quoted inquiries (test rows already removed) and hands
// them here. The suggestion is advice only; nothing is applied automatically.
//
// Suggested rate: with the CURRENT base and spread, the rate per gram that
// would put the middle of our range on the owner's quotes, solved over all
// quoted requests together (least squares through the origin):
//   target_i = final_i × 2 / (1 + spread)     (the subtotal whose range midpoint = final)
//   rate     = Σ (target_i − base − parts_i) / Σ grams_i
// Requests with no printed grams still count in the averages but cannot move
// the rate. Fewer than MIN_QUOTES quotes → no suggestion yet.

import { isTestRow } from "../admin/test-data";
import { parseQuoteCalc, type QuoteCalc, type QuoteRule } from "./request-summary";

export const MIN_QUOTES = 3;
/** Within ±5 % of the estimate on average = "no change needed". */
export const ON_TARGET_PCT = 5;

export type QuotedRow = { finalQar: number; calc: Pick<QuoteCalc, "low" | "high" | "midpoint" | "parts_qar" | "printed_grams"> };

export type AccuracySuggestion =
  | { kind: "too_few"; needed: number }
  | { kind: "on_target"; pct: number }
  | { kind: "raise" | "lower"; pct: number; perGramQar: number }
  | { kind: "no_grams"; pct: number };

export type QuoteAccuracy = {
  count: number;
  /** Average of final ÷ estimate midpoint (1.18 = 18 % above). null with no rows. */
  avgFinalOverMid: number | null;
  /** Average of final ÷ low end of the range. */
  avgFinalOverLow: number | null;
  /** (avgFinalOverMid − 1) × 100, one decimal. */
  pctVsMid: number | null;
  below: number;
  inside: number;
  above: number;
  suggestion: AccuracySuggestion;
};

/** Inquiries rows (select *) → the quoted Studio requests, test rows left out (lib/admin/test-data.ts). */
export function quotedRows(
  rows: readonly { id: string; name?: string | null; message?: string | null; is_test?: boolean | null; quote_calc?: unknown; final_quote_qar?: number | string | null }[],
): QuotedRow[] {
  const out: QuotedRow[] = [];
  for (const r of rows) {
    if (r.final_quote_qar === null || r.final_quote_qar === undefined) continue;
    if (isTestRow({ id: r.id, is_test: r.is_test, texts: [r.name, r.message] })) continue;
    const calc = parseQuoteCalc(r.quote_calc);
    const finalQar = Number(r.final_quote_qar);
    if (calc && Number.isFinite(finalQar)) out.push({ finalQar, calc });
  }
  return out;
}

const round1 =(n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function quoteAccuracy(rows: readonly QuotedRow[], rule: QuoteRule): QuoteAccuracy {
  const usable = rows.filter(
    (r) => Number.isFinite(r.finalQar) && r.finalQar > 0 && r.calc.midpoint !== null && r.calc.midpoint > 0 && r.calc.low !== null && r.calc.low > 0,
  );
  const overMid = mean(usable.map((r) => r.finalQar / r.calc.midpoint!));
  const overLow = mean(usable.map((r) => r.finalQar / r.calc.low!));
  let below = 0;
  let inside = 0;
  let above = 0;
  for (const r of usable) {
    if (r.finalQar < r.calc.low!) below += 1;
    else if (r.calc.high !== null && r.finalQar > r.calc.high) above += 1;
    else inside += 1;
  }
  const pct = overMid === null ? null : round1((overMid - 1) * 100);

  let suggestion: AccuracySuggestion;
  if (usable.length < MIN_QUOTES || pct === null) suggestion = { kind: "too_few", needed: MIN_QUOTES - usable.length };
  else if (Math.abs(pct) < ON_TARGET_PCT) suggestion = { kind: "on_target", pct };
  else {
    const withGrams = usable.filter((r) => r.calc.printed_grams > 0);
    const grams = withGrams.reduce((g, r) => g + r.calc.printed_grams, 0);
    if (!(grams > 0)) suggestion = { kind: "no_grams", pct };
    else {
      const need = withGrams.reduce((s, r) => s + (r.finalQar * 2) / (1 + rule.spread) - rule.base_qar - (r.calc.parts_qar || 0), 0);
      const perGramQar = Math.max(0, round2(need / grams));
      suggestion =
        perGramQar === round2(rule.per_gram_qar)
          ? { kind: "on_target", pct }
          : { kind: perGramQar > rule.per_gram_qar ? "raise" : "lower", pct, perGramQar };
    }
  }

  return {
    count: usable.length,
    avgFinalOverMid: overMid === null ? null : round2(overMid),
    avgFinalOverLow: overLow === null ? null : round2(overLow),
    pctVsMid: pct,
    below,
    inside,
    above,
    suggestion,
  };
}
