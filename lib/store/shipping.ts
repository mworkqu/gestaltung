// What delivery costs (site review Phase A, migration 0044). The database is
// the authority — order_delivery_quote shows the price and create_part_order
// charges it — and these pure helpers mirror its rules so the cart, product
// page and checkout show the same numbers before the order exists.
//
// GOODS SUBTOTAL (same definition as public.order_goods_qar in 0044): the
// items at their listed prices less the kit discount; BEFORE shipping,
// handling and any AI-credit redemption. In the cart that is
// useCart().totalQar; at checkout prefer the quote's free_shipping.goods_qar.
//
// Free delivery: when store_settings.free_shipping_threshold is configured
// (threshold_qar > 0), a tier listed in its `tiers` ships free once the goods
// subtotal reaches the threshold. Free means 0, also for a split order.

import type { FreeShippingQuote, ShippingTier, TierQuote } from "@/lib/store/delivery";

export type FreeShippingConfig = Pick<FreeShippingQuote, "threshold_qar" | "tiers">;

type Tiers = Partial<Record<ShippingTier, Pick<TierQuote, "carrier_cost_qar"> & { base_cost_qar?: number }>>;

/** The configured threshold, or null when there is no free delivery. */
export function activeFreeShipping(fs: FreeShippingConfig | null | undefined): FreeShippingConfig | null {
  if (!fs) return null;
  const threshold = Number(fs.threshold_qar);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  return { threshold_qar: threshold, tiers: Array.isArray(fs.tiers) ? fs.tiers : [] };
}

/** Mirrors public.free_shipping_applies(tier, goods). */
export function tierShipsFree(
  tier: ShippingTier,
  goodsQar: number,
  fs: FreeShippingConfig | null | undefined
): boolean {
  const cfg = activeFreeShipping(fs);
  if (!cfg) return false;
  return cfg.tiers.includes(tier) && goodsQar >= cfg.threshold_qar;
}

/** A tier's normal price for one shipment (before any free delivery). */
export function baseCost(t: { carrier_cost_qar: number; base_cost_qar?: number } | undefined): number {
  if (!t) return 0;
  return Number(t.base_cost_qar ?? t.carrier_cost_qar) || 0;
}

/**
 * Shipping and handling for one tier. `split` doubles the carrier cost (two
 * shipments) unless the tier ships free. Handling is never negative; the UI
 * shows its line only when it is above 0.
 */
export function shippingFor(o: {
  tier: ShippingTier;
  goodsQar: number;
  tiers: Tiers;
  handlingFeeQar?: number | null;
  freeShipping?: FreeShippingConfig | null;
  split?: boolean;
}): { shippingQar: number; handlingQar: number; free: boolean } {
  const t = o.tiers[o.tier];
  const handlingQar = Math.max(0, Number(o.handlingFeeQar) || 0);
  if (!t) return { shippingQar: 0, handlingQar, free: false };
  const free = tierShipsFree(o.tier, o.goodsQar, o.freeShipping);
  const shippingQar = free ? 0 : baseCost(t) * (o.split ? 2 : 1);
  return { shippingQar, handlingQar, free };
}

/** The cheapest normal tier price ("Delivery from QAR …"); null when no tier. */
export function minDeliveryFrom(tiers: Tiers | null | undefined): number | null {
  if (!tiers) return null;
  const costs = Object.values(tiers)
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => baseCost(t));
  return costs.length ? Math.min(...costs) : null;
}

/**
 * How much more to add for free delivery, in whole QAR rounded up. 0 when the
 * goods subtotal already qualifies; null when there is no free delivery.
 */
export function freeDeliveryGap(goodsQar: number, fs: FreeShippingConfig | null | undefined): number | null {
  const cfg = activeFreeShipping(fs);
  if (!cfg) return null;
  const missing = Math.round((cfg.threshold_qar - goodsQar) * 100) / 100;
  return missing <= 0 ? 0 : Math.ceil(missing);
}

/** A QAR amount for a message placeholder: "50", or "12.50" when not whole. */
export function qarAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** something@something.something, no spaces — same as public.is_plausible_email. */
export function isPlausibleEmail(email: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email ?? "").trim());
}
