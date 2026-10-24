// The daily delivery-promises re-check, minus the I/O (app/api/cron/delivery-promises).
// Given an open order, its lines and the shipping/holiday settings, decide
// whether the promised date moved and what to write. The date maths itself is
// reviewPromise (lib/store/delivery.ts) → promiseDate → addWorkingDays
// (lib/store/working-days.ts, Qatar weekend + holidays, mirrors
// order_delivery_quote v3); this module only maps rows in and writes out.

import { reviewPromise } from "@/lib/store/delivery";
import type { Holidays } from "@/lib/store/working-days";

/** store_settings.shipping as the cron reads it (fields are optional: defaults below). */
export type CronShippingConfig = {
  handling_days?: number;
  buffer_days?: number;
  tiers?: Record<string, { transit_days?: number }>;
};

/** A part_order_items row joined with its part's current lead-time class. */
export type PromiseItemRow = {
  id: string;
  part_name: string;
  lead_time_class: string | null;
  part: { lead_time_class: string | null } | null;
};

/** The part_orders columns the review reads. */
export type PromiseOrder = {
  created_at: string;
  promised_date: string;
  shipping_tier?: string | null;
};

export type PromisePlan = {
  /** The lines whose lead-time class changed since the sale. */
  changed: PromiseItemRow[];
  oldDate: string;
  /** The date to promise now (never earlier than `oldDate`), null when a dated line lost its offer. */
  newDate: string | null;
  /** Snapshots to refresh so each change is emailed once. */
  itemUpdates: { id: string; lead_time_class: string | null }[];
};

/** Defaults mirror order_delivery_quote: handling 1, buffer 3, transit 0. */
export function shippingInputs(cfg: CronShippingConfig, tier: string | null | undefined) {
  return {
    handlingDays: cfg.handling_days ?? 1,
    transitDays: cfg.tiers?.[tier ?? "standard"]?.transit_days ?? 0,
    bufferDays: cfg.buffer_days ?? 3,
  };
}

/**
 * Re-quote one order. Null when no datable line's class changed (nothing to
 * send or write). `holidays` null = no holidays row (calendar days, pre-0054).
 */
export function planPromiseReview(
  order: PromiseOrder,
  rows: readonly PromiseItemRow[],
  cfg: CronShippingConfig,
  holidays: Holidays | null,
): PromisePlan | null {
  const oldDate = order.promised_date;
  const review = reviewPromise(
    rows.map((r) => ({ sold: r.lead_time_class, current: r.part ? r.part.lead_time_class : r.lead_time_class })),
    {
      orderDate: String(order.created_at).slice(0, 10),
      oldDate,
      ...shippingInputs(cfg, order.shipping_tier),
      holidays,
    },
  );
  if (!review) return null;
  const changed = review.changed.map((i) => rows[i]);
  const newDate = review.newDate;
  return {
    changed,
    oldDate,
    newDate,
    itemUpdates: changed.map((r) => ({ id: r.id, lead_time_class: r.part!.lead_time_class })),
  };
}

/**
 * Columns for part_orders: the new date when it moved later, and
 * delay_notified_at (stamped `now`) when the date moved or was lost. `{}` when
 * the promise holds.
 */
export function orderUpdateFor(
  plan: Pick<PromisePlan, "oldDate" | "newDate">,
  now: Date,
): { promised_date?: string; delay_notified_at?: string } {
  const { oldDate, newDate } = plan;
  return {
    ...(newDate && newDate !== oldDate ? { promised_date: newDate } : {}),
    ...(newDate !== oldDate ? { delay_notified_at: now.toISOString() } : {}),
  };
}

/** One line of the owner's summary email. `email`: "no_address" means the customer is reached on WhatsApp. */
export function reportLine(
  order: { id: unknown; customer_name: unknown },
  plan: Pick<PromisePlan, "changed" | "oldDate" | "newDate">,
  email: "sent" | "failed" | "no_address",
): string {
  return (
    `${String(order.id).slice(0, 8)} ${order.customer_name}: ${plan.changed.map((c) => c.part_name).join(", ")} — ` +
    `${plan.oldDate} → ${plan.newDate ?? "undated"}${email === "no_address" ? " (no email — contact on WhatsApp)" : email === "sent" ? " (emailed)" : " (EMAIL FAILED)"}`
  );
}
