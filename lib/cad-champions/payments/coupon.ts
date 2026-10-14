// Coupon rules and discount maths (Prompt 10 Step A). PURE, tested. The same
// rules run in SQL (public.cc_validate_coupon, 0084) for the instant check in
// checkout; the server re-checks with these functions before it creates a
// payment, so the amount is never taken from the browser.

import type { CcDiscountType } from "../db/types";

export type CouponRejectReason = "invalid" | "expired" | "used_up" | "wrong_plan" | "wrong_institution";

export interface CouponRule {
  code: string;
  discount_type: CcDiscountType;
  discount_value: number;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  plan_ids: string[] | null;
  institution: string | null;
  is_active: boolean;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/** Why a coupon can't be used for this plan, or ok. Same order as the SQL. */
export function checkCoupon(
  c: CouponRule | null,
  ctx: { planId: string; institution: string | null; now?: Date },
): { ok: true } | { ok: false; reason: CouponRejectReason } {
  const now = ctx.now ?? new Date();
  if (!c || !c.is_active) return { ok: false, reason: "invalid" };
  if (c.expires_at && new Date(c.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (c.max_uses != null && c.used_count >= c.max_uses) return { ok: false, reason: "used_up" };
  if (c.plan_ids && c.plan_ids.length > 0 && !c.plan_ids.includes(ctx.planId)) return { ok: false, reason: "wrong_plan" };
  if (c.institution && c.institution.trim() !== "") {
    if ((ctx.institution ?? "").trim().toLowerCase() !== c.institution.trim().toLowerCase()) return { ok: false, reason: "wrong_institution" };
  }
  return { ok: true };
}

/** Discount in QAR on `price`: percent capped at 100, fixed capped at the price. */
export function discountAmount(type: CcDiscountType, value: number, price: number): number {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  if (type === "percent") return round2((price * Math.min(value, 100)) / 100);
  return round2(Math.min(value, price));
}

export interface Totals {
  list: number;
  discount: number;
  addon: number;
  amount: number;
}

/** Plan price minus the coupon (coupons apply to the plan only), plus the add-on. */
export function computeTotals(input: {
  planPrice: number;
  coupon?: { type: CcDiscountType; value: number } | null;
  addonPrice?: number | null;
}): Totals {
  const list = round2(Math.max(0, input.planPrice));
  const discount = input.coupon ? discountAmount(input.coupon.type, input.coupon.value, list) : 0;
  const addon = round2(Math.max(0, input.addonPrice ?? 0));
  return { list, discount, addon, amount: round2(list - discount + addon) };
}
