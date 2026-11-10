// Instant coupon check for CAD Champions checkout (moved from ./server.ts so
// that module stays free of next/*: this one needs the cookie-bound session
// client from lib/supabase/server). SERVER ONLY.

import { normalizeCouponCode, type CouponRejectReason } from "./coupon";
import { isMissingSchema } from "./server";

export type CouponCheck =
  | { ok: true; code: string; discountQar: number; amountQar: number }
  | { ok: false; reason: CouponRejectReason | "too_many" | "signed_out" | "not_set_up" | "error" };

/** Instant check in checkout, via the SECURITY DEFINER RPC (the coupon table stays admin-only). */
export async function validateCouponForUser(code: string, planId: string): Promise<CouponCheck> {
  const { createClient } = await import("@/lib/supabase/server");
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("cc_validate_coupon", { p_code: normalizeCouponCode(code), p_plan: planId });
    if (error) return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
    const r = (data ?? {}) as { ok?: boolean; reason?: string; code?: string; discount_qar?: number | string; amount_qar?: number | string };
    if (!r.ok) {
      const reason = (["invalid", "expired", "used_up", "wrong_plan", "wrong_institution", "too_many", "signed_out"] as const).find((x) => x === r.reason) ?? "invalid";
      return { ok: false, reason };
    }
    return { ok: true, code: String(r.code ?? ""), discountQar: Number(r.discount_qar ?? 0), amountQar: Number(r.amount_qar ?? 0) };
  } catch (e) {
    console.error("[cc-payments] coupon check failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
