// Owner rule (2026-10-10) for anything we pay for per use (cloud CAD builds,
// paid AI calls): the client pays 10 times what it costs us, plus the 12 %
// office tax, rounded UP to the next QAR 10. When it costs us nothing (free
// tier) the price is the minimum, QAR 20 (= one credit today).
//
//   price = max(20, ceil(cost × 10 × 1.12 / 10) × 10)
//
// Not wired into checkout yet: credits are still QAR 20 each. Use this when a
// per-use cost is tracked and shown.

export type UsagePriceRule = {
  multiplier: number;
  office_tax_pct: number;
  round_to_qar: number;
  minimum_qar: number;
};

export const USAGE_PRICE_RULE: UsagePriceRule = {
  multiplier: 10,
  office_tax_pct: 12,
  round_to_qar: 10,
  minimum_qar: 20,
};

/** Client price in QAR for something that cost us `costQar`. */
export function usagePriceQar(costQar: number, rule: UsagePriceRule = USAGE_PRICE_RULE): number {
  const cost = Number.isFinite(costQar) && costQar > 0 ? costQar : 0;
  if (cost === 0) return rule.minimum_qar;
  // Work in fils (1/100 QAR) so 1.12 × 10 does not round up a whole step by float error.
  const fils = Math.round(cost * rule.multiplier * (100 + rule.office_tax_pct));
  const step = rule.round_to_qar * 100;
  const rounded = (Math.ceil(fils / step) * step) / 100;
  return Math.max(rule.minimum_qar, rounded);
}
