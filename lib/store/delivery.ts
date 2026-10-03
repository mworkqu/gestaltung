// Honest delivery dates (Task 18). The database computes the quote
// (public.order_delivery_quote, migration 0029) and create_part_order records
// the same numbers, so what the customer is shown is what the order promises.
// This file is the shapes, the formatting and small pure helpers (which lines
// are "date to be confirmed", the cron's re-check of a promised date).

import type { LeadTimeClass } from "@/lib/store/sourcing";

export const SHIPPING_TIERS = ["express", "standard", "economy"] as const;
export type ShippingTier = (typeof SHIPPING_TIERS)[number];

export type TierQuote = {
  /** What this cart pays for one shipment on this tier (0 when it ships free, 0044). */
  carrier_cost_qar: number;
  /** The tier's normal price (0044; absent before — then carrier_cost_qar is it). */
  base_cost_qar?: number;
  /** This cart ships free on this tier (0044). */
  free?: boolean;
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
  /**
   * Part ids with no supplier offer ("available on request"). They can be
   * ordered at the listed price (0032); their delivery date is to be
   * confirmed and they are left out of the tier dates.
   */
  on_request: string[];
  /**
   * Free delivery (0044): null/absent when not configured. goods_qar is the
   * server's goods subtotal for these lines (see lib/store/shipping.ts).
   */
  free_shipping?: FreeShippingQuote | null;
};

export type FreeShippingQuote = {
  threshold_qar: number;
  tiers: ShippingTier[];
  goods_qar?: number;
  qualifies?: boolean;
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
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(d);
}

type DatableLine = { partId: string; leadTimeClass?: LeadTimeClass | null };

/**
 * Is this line "available on request" (date to be confirmed)? The server
 * quote's on_request ids win; before the quote has loaded, fall back to the
 * lead-time class the line was added with.
 */
export function isOnRequest(line: DatableLine, onRequestIds?: readonly string[] | null): boolean {
  if (onRequestIds) return onRequestIds.includes(line.partId);
  return !line.leadTimeClass;
}

/** Lines the quote can date vs lines whose date is to be confirmed. */
export function splitByDatability<T extends DatableLine>(
  lines: readonly T[],
  onRequestIds?: readonly string[] | null
): { datable: T[]; toConfirm: T[] } {
  const datable: T[] = [];
  const toConfirm: T[] = [];
  for (const l of lines) (isOnRequest(l, onRequestIds) ? toConfirm : datable).push(l);
  return { datable, toConfirm };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One order line as the delivery-promises cron sees it. */
export type PromiseLine = {
  /** Lead-time class snapshotted on the line (null = sold on request). */
  sold: string | null;
  /** The product's lead-time class today. */
  current: string | null;
};

/**
 * Re-check an order's promised date (the daily cron). Lines sold on request
 * (sold = null) never had a date and are skipped. Returns null when no
 * datable line's class changed. Otherwise `changed` are the indexes of the
 * changed lines and `newDate` is the date to promise now: never earlier than
 * the old one, or null when a datable line lost its offer (can't be dated).
 */
export function reviewPromise(
  lines: readonly PromiseLine[],
  o: { orderDate: string; oldDate: string; handlingDays: number; transitDays: number; bufferDays: number }
): { changed: number[]; newDate: string | null } | null {
  const datable = lines.map((l, i) => ({ ...l, i })).filter((l) => l.sold !== null);
  const changed = datable.filter((l) => l.current !== l.sold).map((l) => l.i);
  if (!changed.length) return null;
  if (datable.some((l) => !l.current)) return { changed, newDate: null };
  const lead = Math.max(...datable.map((l) => LEAD_CLASS_DAYS[l.current as LeadTimeClass] ?? 28));
  const recomputed = addDays(o.orderDate, lead + o.handlingDays + o.transitDays + o.bufferDays);
  return { changed, newDate: recomputed > o.oldDate ? recomputed : o.oldDate };
}
