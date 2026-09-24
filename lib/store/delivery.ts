// Honest delivery dates (Task 18). The database computes the quote
// (public.order_delivery_quote, migration 0029) and create_part_order records
// the same numbers, so what the customer is shown is what the order promises.
// This file is the shapes and the formatting only.

import type { LeadTimeClass } from "@/lib/store/sourcing";

export const SHIPPING_TIERS = ["express", "standard", "economy"] as const;
export type ShippingTier = (typeof SHIPPING_TIERS)[number];

export type TierQuote = {
  carrier_cost_qar: number;
  transit_days: number;
  /** ISO date; null when nothing in the order can be dated. */
  date: string | null;
  /** The earlier shipment's date when the order is split. */
  early_date: string | null;
};

export type DeliveryQuote = {
  tiers: Partial<Record<ShippingTier, TierQuote>>;
  handling_fee_qar: number;
  /** Name of the item holding a mixed order back. */
  held_by: string | null;
  can_split: boolean;
  /** Part ids that have no supplier offer — cannot be ordered. */
  on_request: string[];
};

/** Upper bound of each class in days — mirrors public.lead_class_days(). */
export const LEAD_CLASS_DAYS: Record<LeadTimeClass, number> = {
  in_stock: 2,
  "3_5_days": 5,
  "1_2_weeks": 14,
  "2_4_weeks": 28,
};

/** "14 October" / "١٤ أكتوبر" — a date, not a duration. */
export function formatDeliveryDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(d);
}

export function shippingTotal(q: DeliveryQuote, tier: ShippingTier, split: boolean): number {
  const t = q.tiers[tier];
  if (!t) return 0;
  return t.carrier_cost_qar * (split && q.can_split ? 2 : 1);
}
