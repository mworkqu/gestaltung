// Small display rules for the product card and product page (Phase C4).
// Pure, so they are unit-tested and the card and the page cannot drift apart.

import type { LeadTimeClass } from "@/lib/store/sourcing";

/**
 * "Min. order: n" is shown only when it says something: a minimum of 1 (or a
 * missing/invalid value) is no minimum, and we say nothing about it.
 */
export function showMinOrder(qty: number | null | undefined): boolean {
  return typeof qty === "number" && Number.isFinite(qty) && qty > 1;
}

/**
 * "Request this item" belongs on products we can't promise a date for. In
 * this codebase "out of stock" IS "no lead-time class": the storefront never
 * reads parts.stock_status (admin-only), and lead_time_class is null exactly
 * when no active supplier offer has stock (out of stock at Voltaat, or never
 * sourced). Anything with a class is normally orderable.
 */
export function canRequestItem(leadTimeClass: LeadTimeClass | null | undefined): boolean {
  return !leadTimeClass;
}
