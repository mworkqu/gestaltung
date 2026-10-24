// What a supplier part costs us delivered, and the shelf price we suggest for
// it (admin supplier lookup). The database derives the landed cost of offers
// already in the store (refresh_part_sourcing); this is the same idea for a
// search result that is not in the store yet.

import { round2 } from "@/lib/format/money";

export type LookupPricing = {
  /** QAR per USD (lib/pricing/fx qarPerUnit). */
  usdToQar: number;
  /** suppliers.landed_overhead_pct by supplier code (freight, duty, fees). */
  overheadPct: Record<string, number>;
  /** Suggested markup over landed cost, in percent. */
  markup: number;
};

/**
 * Landed cost in QAR, rounded to the fils: supplier cost, converted from USD
 * unless already in QAR, plus the supplier's overhead. null when there is no cost.
 */
export function landedCostQar(
  offer: { cost: number | null; currency: string; supplierCode: string },
  pricing: Pick<LookupPricing, "usdToQar" | "overheadPct">
): number | null {
  if (offer.cost === null) return null;
  const fx = offer.currency === "QAR" ? 1 : pricing.usdToQar;
  return round2(offer.cost * fx * (1 + (pricing.overheadPct[offer.supplierCode] ?? 0) / 100));
}

/** Landed cost plus markup, rounded UP to the next QAR 0.50, never below QAR 1. */
export function suggestedPriceQar(landed: number, markupPct: number): number {
  return Math.max(1, Math.ceil(landed * (1 + markupPct / 100) * 2) / 2);
}
