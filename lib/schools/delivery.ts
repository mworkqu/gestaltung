// The class-order delivery rule (3e). A teacher buying the parts for every team
// in one order gets Economy delivery at QAR 0; every other order is unchanged.
//
// The rule is enforced in Postgres — class_order_delivery_quote() for the quote
// and create_part_order(p_class_id) for the order (migration 0097) — so the
// browser cannot grant itself free delivery. This file is the same rule in
// TypeScript, used to show the quote and tested here, exactly as
// lib/store/shipping.ts mirrors the SQL for normal orders.

import type { DeliveryQuote, ShippingTier, TierQuote } from "@/lib/store/delivery";
import type { SchoolPricing } from "@/lib/schools/pricing";

/** The tier a class order ships on. */
export const CLASS_ORDER_TIER: ShippingTier = "economy";

/**
 * The quote a teacher is shown for a class order: Economy at 0 when the setting
 * allows it. Returns the quote unchanged for a normal order, when the setting
 * is off, or when the quote has no Economy tier.
 */
export function applyClassDelivery(quote: DeliveryQuote, pricing: SchoolPricing, isClassOrder: boolean): DeliveryQuote {
  if (!isClassOrder || !pricing.free_delivery_class_order) return quote;
  const economy = quote.tiers[CLASS_ORDER_TIER];
  if (!economy) return quote;
  const free: TierQuote = { ...economy, carrier_cost_qar: 0, base_cost_qar: 0, free: true };
  return { ...quote, tiers: { ...quote.tiers, [CLASS_ORDER_TIER]: free } };
}

/** What a class order pays for delivery, after the rule. */
export function classDeliveryQar(quote: DeliveryQuote, pricing: SchoolPricing): number {
  const tier = applyClassDelivery(quote, pricing, true).tiers[CLASS_ORDER_TIER];
  if (!tier) return 0;
  return tier.carrier_cost_qar;
}

/** True when this order ships free because it is a class order, not by threshold. */
export function freeByClassRule(quote: DeliveryQuote, pricing: SchoolPricing): boolean {
  if (!pricing.free_delivery_class_order) return false;
  const economy = quote.tiers[CLASS_ORDER_TIER];
  if (!economy) return false;
  const normal = economy.base_cost_qar ?? economy.carrier_cost_qar;
  return normal > 0;
}
