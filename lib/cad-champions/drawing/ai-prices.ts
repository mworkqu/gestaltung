// Anthropic price table for the cost estimate in cc_grading_logs.cost_estimate
// (USD). ONE place to edit. [TODO-MO: confirm prices against the Anthropic
// pricing page before relying on the monthly cost figure.]
// Prices are USD per million tokens (first-party API, 2026-10).

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const ANTHROPIC_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
};

/** Used when the model is not in the table (an estimate is better than none). */
export const FALLBACK_PRICE: ModelPrice = { inputPerMTok: 2, outputPerMTok: 10 };

/** Estimated cost in USD, rounded to 4 decimals (the column is numeric(10,4)). */
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = ANTHROPIC_PRICES[model] ?? FALLBACK_PRICE;
  const usd = (Math.max(0, tokensIn) * p.inputPerMTok + Math.max(0, tokensOut) * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}
