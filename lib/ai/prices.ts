// What one AI call costs us, in USD, at the provider's PAID list price. Pure.
//
// The ONE place model prices live. logUsage() stores the result in
// ai_usage.cost_usd (migration 0088); /dashboard/ai-costs also uses it to
// price rows logged before 0088. While we stay on Gemini's free tier the
// real bill is $0 — these figures are what the same traffic would cost on
// the paid tier, which is what scaling plans need.
//
// Prices per 1M tokens. Defaults are Google's published Flash-Lite / Flash
// paid rates — re-check at https://ai.google.dev/gemini-api/docs/pricing when
// a model changes. Override without a code change with AI_PRICES, e.g.
//   AI_PRICES={"gemini-3.5-flash-lite":{"in":0.1,"out":0.4}}
// Thinking tokens are billed as output: a call's billed output is
// max(completion, total − prompt).

export type ModelPrice = { in: number; out: number };

const DEFAULT_PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /flash-lite/i, price: { in: 0.1, out: 0.4 } },
  { match: /flash/i, price: { in: 0.3, out: 2.5 } },
  { match: /pro/i, price: { in: 1.25, out: 10 } },
];

/** Groq Whisper large-v3: USD per audio hour. */
export const WHISPER_USD_PER_HOUR = 0.111;

function overrides(): Record<string, ModelPrice> {
  const raw = process.env.AI_PRICES?.trim();
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, { in?: unknown; out?: unknown }>;
    const out: Record<string, ModelPrice> = {};
    for (const [k, p] of Object.entries(v)) {
      const i = Number(p?.in);
      const o = Number(p?.out);
      if (Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) out[k.toLowerCase()] = { in: i, out: o };
    }
    return out;
  } catch {
    return {};
  }
}

export function modelPrice(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const exact = overrides()[model.toLowerCase()];
  if (exact) return exact;
  return DEFAULT_PRICES.find((p) => p.match.test(model))?.price ?? null;
}

/** USD for one call, or null when the model has no known price. */
export function callCostUsd(u: {
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  audioSeconds?: number | null;
}): number | null {
  if (u.audioSeconds != null && u.audioSeconds > 0) return (u.audioSeconds / 3600) * WHISPER_USD_PER_HOUR;
  const price = modelPrice(u.model);
  if (!price) return null;
  const input = Math.max(0, u.promptTokens ?? 0);
  const out = Math.max(0, u.completionTokens ?? 0, (u.totalTokens ?? 0) - input);
  if (!input && !out) return 0;
  return (input * price.in + out * price.out) / 1_000_000;
}
