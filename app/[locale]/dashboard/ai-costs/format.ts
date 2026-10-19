import { callCostUsd } from "@/lib/ai/prices";
import { DEFAULT_QAR_PER_USD } from "@/lib/pricing/fx";
import { USAGE_PRICE_RULE } from "@/lib/pricing/usage-price";

// Shared helpers for the AI costs pages: pure formatting + cost fallbacks.

export function usdFormatter(locale: string) {
  const loc = locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB";
  const small = new Intl.NumberFormat(loc, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const big = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return "—";
    return `$${Math.abs(v) >= 1 ? big.format(v) : small.format(v)}`;
  };
}

/** True when the error means migration 0088 has not run yet. */
export function needsMigration(error: { code?: string } | null | undefined) {
  return !!error && ["PGRST202", "42883", "42703", "42P01", "PGRST205"].includes(error.code ?? "");
}

export type CallRow = {
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  audio_seconds: number | null;
  cost_usd: number | string | null;
};

/** Stored cost, else the list price of the same tokens, else null. */
export function rowCost(r: CallRow): number | null {
  if (r.cost_usd != null) return Number(r.cost_usd);
  return callCostUsd({
    model: r.model,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    totalTokens: r.total_tokens,
    audioSeconds: r.audio_seconds,
  });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** QAR per USD (the riyal is pegged); AI cost is stored in USD, revenue in QAR. */
export const QAR_PER_USD = DEFAULT_QAR_PER_USD;

/**
 * What the same work is worth to a client: the owner's pay-as-you-go rule is
 * 10x what it costs us (lib/pricing/usage-price.ts). These pages show the raw
 * 10x figure, not the rounded credit price — it is the margin check, not a
 * price list.
 */
export const COST_MULTIPLIER = USAGE_PRICE_RULE.multiplier;

/** Cost in USD -> what we would charge for it, in QAR, before rounding. */
export function billableQar(costUsd: number | null | undefined): number | null {
  if (costUsd == null || !Number.isFinite(costUsd)) return null;
  return costUsd * COST_MULTIPLIER * QAR_PER_USD;
}

export function qarFormatter(locale: string) {
  const f = new Intl.NumberFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${f.format(v)} QAR`);
}

/** True when migration 0089 (payments / passes / revenue RPC) has not run yet. */
export function needsPaymentsMigration(error: { code?: string } | null | undefined) {
  return needsMigration(error);
}

export type RevenueRow = {
  user_id: string;
  revenue_qar: number | string | null;
  payments: number | string | null;
  pass_until: string | null;
  pass_balance: number | string | null;
  idea_balance: number | string | null;
};
