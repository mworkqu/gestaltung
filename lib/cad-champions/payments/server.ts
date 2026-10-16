// CAD Champions payments on the server (Prompt 10) — SERVER ONLY.
//
// Every write goes through the service role AFTER the caller's auth and
// ownership were checked here; the database only accepts status changes
// through cc_payment_transition (0084), which enforces the state machine,
// locks the row (no double approval) and creates the enrollment on paid.
// Students can only READ their own cc_payments / cc_enrollments (RLS), and
// the two writing RPCs are executable by service_role only, so payment status
// and enrollments can't be forged by calling the API directly.
//
// Everything degrades before 0084 has run: reads return { ok:false,
// reason:"not_set_up" } and pages show a "being set up" state.

import type { Locale } from "@/i18n/routing";
import { defaultSiteUrl } from "@/lib/email/brand-layout";
import { createServiceClient } from "@/lib/supabase/service";

import type { CcUser } from "../auth/server";
import type { CcPaymentMethod, CcPaymentStatus } from "../db/types";
import { formatDate, formatDateTime, formatQAR } from "../format";
import { ccPath } from "../routes";
import { verifyUploadedObject } from "../upload/server";
import { isPathUnderPrefix } from "../upload/validate";
import { checkCoupon, computeTotals, normalizeCouponCode, type CouponRejectReason, type CouponRule } from "./coupon";
import { sendOwnerProofAlert, sendPaymentEmail, type PaymentEmailData, type PaymentEmailKind } from "./emails";
import { getFawranDetails, isQatarBank } from "./fawran";
import { canSeePrices, cohortAvailability, isAddonAvailable, isPurchasable, needsCohort, priceOf, reminderDue, reservationExpiry, type CohortAvailability } from "./plans";
import { generateReferenceCode } from "./reference-code";
import { createSkipCashPayment, decideWebhook, getSkipCashPayment, isSkipCashEnabled, parseSkipCashWebhook } from "./skipcash";
import { transitionErrorCode, type TransitionErrorCode } from "./state-machine";
import { sortAdminQueue } from "./status";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/payments/server.ts is server-only");

export const PROOF_BUCKET = "cc-payment-proofs";
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Service = NonNullable<ReturnType<typeof createServiceClient>>;

export function isMissingSchema(code: string | undefined): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204" || code === "PGRST202" || code === "PGRST200" || code === "42883";
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

// ─── catalog ─────────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  slug: string;
  kind: "online" | "online_in_person" | "kit";
  name_en: string;
  name_ar: string;
  who_for_en: string | null;
  who_for_ar: string | null;
  includes_en: string[];
  includes_ar: string[];
  price_qar: number | null;
  duration_days: number | null;
  includes_in_person: boolean;
  is_featured: boolean;
  is_active: boolean;
  sort: number;
}

export interface CohortView {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  starts_on: string | null;
  ends_on: string | null;
  schedule_en: string | null;
  schedule_ar: string | null;
  location_en: string | null;
  location_ar: string | null;
  seats_total: number;
  status: string;
  taken: number;
  availability: CohortAvailability;
}

export type Catalog = { ok: true; plans: PlanRow[]; addon: PlanRow | null; cohorts: CohortView[] } | { ok: false; reason: "not_set_up" | "error" };

function toPlan(r: Record<string, unknown>): PlanRow {
  const kindRaw = r.kind as string | undefined;
  const kind = kindRaw === "kit" || kindRaw === "online_in_person" || kindRaw === "online" ? kindRaw : r.includes_in_person ? "online_in_person" : "online";
  return {
    id: String(r.id),
    slug: String(r.slug),
    kind,
    name_en: String(r.name_en ?? ""),
    name_ar: String(r.name_ar ?? ""),
    who_for_en: (r.who_for_en as string | null) ?? null,
    who_for_ar: (r.who_for_ar as string | null) ?? null,
    includes_en: Array.isArray(r.includes_en) ? (r.includes_en as string[]) : [],
    includes_ar: Array.isArray(r.includes_ar) ? (r.includes_ar as string[]) : [],
    price_qar: priceOf({ price_qar: r.price_qar as number | string | null }),
    duration_days: r.duration_days == null ? null : Number(r.duration_days),
    includes_in_person: !!r.includes_in_person,
    is_featured: !!r.is_featured,
    is_active: !!r.is_active,
    sort: Number(r.sort ?? 0),
  };
}

/** Active plans (training plans + the kit add-on) and the non-draft cohorts with seats taken. */
export async function loadCatalog(): Promise<Catalog> {
  const db = createServiceClient();
  if (!db) return { ok: false, reason: "not_set_up" };
  try {
    const [plansRes, cohortsRes, seatsRes] = await Promise.all([
      db.from("cc_plans").select("*").eq("is_active", true).order("sort").order("created_at"),
      db
        .from("cc_cohorts")
        .select("id,slug,name_en,name_ar,starts_on,ends_on,schedule_en,schedule_ar,location_en,location_ar,seats_total,status")
        .neq("status", "draft")
        .order("starts_on", { ascending: true, nullsFirst: false }),
      db.rpc("cc_cohort_seats"),
    ]);
    if (plansRes.error) return { ok: false, reason: isMissingSchema(plansRes.error.code) ? "not_set_up" : "error" };
    const all = ((plansRes.data ?? []) as Record<string, unknown>[]).map(toPlan);
    const plans = all.filter((p) => p.kind !== "kit");
    const addon = all.find((p) => p.kind === "kit") ?? null;
    const taken = new Map(((seatsRes.data ?? []) as { cohort_id: string; seats_taken: number }[]).map((s) => [s.cohort_id, s.seats_taken]));
    const cohorts = ((cohortsRes.data ?? []) as Omit<CohortView, "taken" | "availability">[]).map((c) => {
      const t = taken.get(c.id) ?? 0;
      return { ...c, taken: t, availability: cohortAvailability(c, t) };
    });
    return { ok: true, plans, addon, cohorts };
  } catch (e) {
    console.error("[cc-payments] catalog failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Prices show only after a submitted diagnostic test (staff always). */
export async function priceGate(cc: CcUser): Promise<boolean> {
  if (cc.isStaff) return true;
  const db = createServiceClient();
  if (!db) return false;
  const { data } = await db.from("cc_journey_progress").select("first_test_submitted_at").eq("user_id", cc.user.id).maybeSingle<{ first_test_submitted_at: string | null }>();
  return canSeePrices({ firstTestSubmittedAt: data?.first_test_submitted_at ?? null, isStaff: cc.isStaff });
}

export interface EnrollmentView {
  id: string;
  plan_id: string | null;
  cohort_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

/** The enrollment that ends last among the student's active ones. */
export async function loadActiveEnrollment(userId: string): Promise<EnrollmentView | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("cc_enrollments")
    .select("id,plan_id,cohort_id,starts_at,ends_at,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle<EnrollmentView>();
  if (error) return null;
  return data ?? null;
}

// ─── coupons ─────────────────────────────────────────────────────────────

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

// ─── checkout ────────────────────────────────────────────────────────────

export type CheckoutError =
  | "not_set_up"
  | "terms"
  | "no_test"
  | "plan_unavailable"
  | "price_missing"
  | "cohort_required"
  | "cohort_full"
  | "cohort_closed"
  | `coupon_${CouponRejectReason}`
  | "pending_review"
  | "skipcash_disabled"
  | "provider_error"
  | "error";

export interface CheckoutInput {
  planSlug: string;
  cohortId: string | null;
  couponCode: string | null;
  addKit: boolean;
  termsAccepted: boolean;
  method: CcPaymentMethod;
}

export type CheckoutResult = { ok: true; paymentId: string; redirectUrl?: string } | { ok: false; error: CheckoutError };

export async function createCheckout(cc: CcUser, input: CheckoutInput, locale: Locale): Promise<CheckoutResult> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "not_set_up" };
  if (!input.termsAccepted) return { ok: false, error: "terms" };
  if (!(await priceGate(cc))) return { ok: false, error: "no_test" };
  const userId = cc.user.id;
  if (!cc.profile) return { ok: false, error: "error" };

  try {
    const { data: planRow, error: planErr } = await db.from("cc_plans").select("*").eq("slug", String(input.planSlug ?? "")).maybeSingle();
    if (planErr) return { ok: false, error: isMissingSchema(planErr.code) ? "not_set_up" : "error" };
    if (!planRow) return { ok: false, error: "plan_unavailable" };
    const plan = toPlan(planRow as Record<string, unknown>);
    if (!plan.is_active || plan.kind === "kit") return { ok: false, error: "plan_unavailable" };
    if (!isPurchasable(plan)) return { ok: false, error: "price_missing" };

    let cohortId: string | null = null;
    if (needsCohort(plan)) {
      if (!isUuid(input.cohortId)) return { ok: false, error: "cohort_required" };
      cohortId = input.cohortId;
    }

    let coupon: CouponRule & { id: string } | null = null;
    if (input.couponCode && input.couponCode.trim()) {
      const code = normalizeCouponCode(input.couponCode);
      const { data } = await db.from("cc_coupons").select("*").eq("code", code).maybeSingle();
      const row = (data ?? null) as (CouponRule & { id: string }) | null;
      const check = checkCoupon(row ? { ...row, discount_value: Number(row.discount_value) } : null, { planId: plan.id, institution: cc.profile.institution });
      if (!check.ok) return { ok: false, error: `coupon_${check.reason}` };
      coupon = row ? { ...row, discount_value: Number(row.discount_value) } : null;
    }

    let addon: PlanRow | null = null;
    if (input.addKit) {
      const { data } = await db.from("cc_plans").select("*").eq("kind", "kit").eq("is_active", true).order("sort").limit(1).maybeSingle();
      const kit = data ? toPlan(data as Record<string, unknown>) : null;
      if (kit && isAddonAvailable(kit)) addon = kit;
    }

    const { data: pending } = await db.from("cc_payments").select("id").eq("user_id", userId).eq("status", "proof_submitted").limit(1);
    if (pending && pending.length > 0) return { ok: false, error: "pending_review" };

    if (input.method === "skipcash" && !isSkipCashEnabled()) return { ok: false, error: "skipcash_disabled" };
    const method: CcPaymentMethod = input.method === "skipcash" ? "skipcash" : "fawran";

    const totals = computeTotals({
      planPrice: plan.price_qar ?? 0,
      coupon: coupon ? { type: coupon.discount_type, value: coupon.discount_value } : null,
      addonPrice: addon?.price_qar ?? null,
    });
    const expiresAt = reservationExpiry();

    let paymentId: string | null = null;
    let reference = "";
    for (let attempt = 0; attempt < 5 && !paymentId; attempt++) {
      reference = generateReferenceCode(attempt < 3 ? 4 : 5);
      const { data, error } = await db.rpc("cc_create_payment", {
        p_user: userId,
        p_plan: plan.id,
        p_cohort: cohortId,
        p_coupon: coupon?.id ?? null,
        p_addon_plan: addon?.id ?? null,
        p_list: totals.list,
        p_discount: totals.discount,
        p_addon: totals.addon,
        p_amount: totals.amount,
        p_method: method,
        p_reference: reference,
        p_expires_at: expiresAt.toISOString(),
        p_terms_at: new Date().toISOString(),
      });
      if (error) {
        if (isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
        console.error("[cc-payments] create payment failed:", error.code ?? error.message);
        return { ok: false, error: "error" };
      }
      const r = (data ?? {}) as { ok?: boolean; id?: string; reason?: string };
      if (r.ok && r.id) paymentId = r.id;
      else if (r.reason === "cohort_full") return { ok: false, error: "cohort_full" };
      else if (r.reason === "cohort_closed") return { ok: false, error: "cohort_closed" };
      else if (r.reason !== "reference_taken") return { ok: false, error: "error" };
    }
    if (!paymentId) return { ok: false, error: "error" };

    if (method === "skipcash") {
      const site = defaultSiteUrl();
      const [firstName, ...rest] = (cc.profile.full_name ?? "").trim().split(/\s+/);
      const created = await createSkipCashPayment({
        paymentId,
        referenceCode: reference,
        amountQar: totals.amount,
        description: `CAD Champions - ${plan.name_en}`,
        customer: { firstName: firstName ?? "", lastName: rest.join(" "), email: cc.user.email ?? cc.profile.email ?? "", phone: cc.profile.phone },
        returnUrl: `${site}${ccPath(locale, "/training/join/return")}?payment=${paymentId}`,
        webhookUrl: `${site}/api/cad-champions/payments/skipcash/webhook`,
      });
      if (!created.ok || created.method !== "skipcash") {
        await transition(db, paymentId, "cancelled", userId, "skipcash_create_failed");
        return { ok: false, error: "provider_error" };
      }
      await db.from("cc_payments").update({ provider_payment_id: created.providerPaymentId, provider_status: "0" }).eq("id", paymentId);
      return { ok: true, paymentId, redirectUrl: created.redirectUrl };
    }

    await notify(paymentId, "reserved");
    return { ok: true, paymentId };
  } catch (e) {
    console.error("[cc-payments] checkout failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}

// ─── transitions ─────────────────────────────────────────────────────────

type TransitionResult = { ok: true; enrollmentId: string | null; receiptNumber: number | null } | { ok: false; error: TransitionErrorCode | "not_set_up" };

async function transition(
  db: Service,
  paymentId: string,
  to: CcPaymentStatus,
  actor: string | null,
  reason: string | null = null,
  reasonAr: string | null = null,
  patch: Record<string, unknown> = {},
): Promise<TransitionResult> {
  const { data, error } = await db.rpc("cc_payment_transition", {
    p_payment: paymentId,
    p_to: to,
    p_actor: actor,
    p_reason: reason,
    p_reason_ar: reasonAr,
    p_patch: patch,
  });
  if (error) {
    if (isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
    const code = transitionErrorCode(error.message);
    if (code === "error") console.error("[cc-payments] transition failed:", to, error.code ?? error.message);
    return { ok: false, error: code };
  }
  const r = (data ?? {}) as { enrollment_id?: string | null; receipt_number?: number | null };
  return { ok: true, enrollmentId: r.enrollment_id ?? null, receiptNumber: r.receipt_number ?? null };
}

interface OwnedPayment {
  id: string;
  user_id: string;
  status: CcPaymentStatus;
  method: CcPaymentMethod;
  expires_at: string | null;
  amount_qar: number;
  provider_payment_id: string | null;
}

async function ownedPayment(db: Service, userId: string, paymentId: string): Promise<OwnedPayment | null> {
  if (!isUuid(paymentId)) return null;
  const { data } = await db
    .from("cc_payments")
    .select("id,user_id,status,method,expires_at,amount_qar,provider_payment_id")
    .eq("id", paymentId)
    .eq("user_id", userId)
    .maybeSingle<OwnedPayment>();
  return data ?? null;
}

export type ProofInput = {
  paymentId: string;
  proofPath: string;
  payerName: string;
  payerBank: string;
  payerBankOther?: string | null;
  transferReference: string;
  transferredAt: string;
};

export type ProofError = "not_set_up" | "not_found" | "not_allowed" | "expired" | "invalid_name" | "invalid_bank" | "invalid_reference" | "invalid_date" | "invalid_file" | "error";

export async function submitProof(cc: CcUser, input: ProofInput): Promise<{ ok: true } | { ok: false; error: ProofError }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "not_set_up" };
  const userId = cc.user.id;
  const p = await ownedPayment(db, userId, input.paymentId);
  if (!p) return { ok: false, error: "not_found" };
  if (p.method !== "fawran" || (p.status !== "awaiting_transfer" && p.status !== "rejected")) return { ok: false, error: "not_allowed" };
  if (p.status === "awaiting_transfer" && p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) {
    await expireOne(db, p.id);
    return { ok: false, error: "expired" };
  }

  const name = String(input.payerName ?? "").trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: "invalid_name" };
  if (!isQatarBank(input.payerBank)) return { ok: false, error: "invalid_bank" };
  const other = String(input.payerBankOther ?? "").trim();
  if (input.payerBank === "other" && (other.length < 2 || other.length > 80)) return { ok: false, error: "invalid_bank" };
  const bank = input.payerBank === "other" ? `other: ${other}` : input.payerBank;
  const ref = String(input.transferReference ?? "").trim();
  if (ref.length < 1 || ref.length > 80) return { ok: false, error: "invalid_reference" };
  const at = new Date(String(input.transferredAt ?? ""));
  const now = Date.now();
  if (Number.isNaN(at.getTime()) || at.getTime() > now + 10 * 60_000 || at.getTime() < now - 30 * 24 * 3600_000) return { ok: false, error: "invalid_date" };

  if (!isPathUnderPrefix(input.proofPath, `${userId}/${p.id}/`)) return { ok: false, error: "invalid_file" };
  const verified = await verifyUploadedObject(PROOF_BUCKET, input.proofPath, "proof", PROOF_MAX_BYTES);
  if (!verified.ok) return { ok: false, error: "invalid_file" };

  const res = await transition(db, p.id, "proof_submitted", userId, null, null, {
    proof_storage_path: input.proofPath,
    payer_name: name,
    payer_bank: bank,
    transfer_reference: ref,
    transferred_at: at.toISOString(),
  });
  if (!res.ok) return { ok: false, error: res.error === "not_set_up" ? "not_set_up" : res.error === "invalid_transition" ? "not_allowed" : "error" };

  await notify(p.id, "proof_received");
  const ctx = await loadEmailContext(p.id);
  if (ctx) {
    await sendOwnerProofAlert(
      {
        studentName: ctx.data.name,
        amount: ctx.data.amount.en,
        referenceCode: ctx.data.referenceCode,
        bank,
        adminUrl: `${defaultSiteUrl()}${ccPath("en", "/admin/payments")}`,
      },
      `cc-proof-owner-${p.id}-${Math.floor(Date.now() / 60_000)}`,
    );
  }
  return { ok: true };
}

/** The student cancels an unpaid reservation (frees a held seat). */
export async function cancelReservation(cc: CcUser, paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "not_set_up" };
  const p = await ownedPayment(db, cc.user.id, paymentId);
  if (!p) return { ok: false, error: "not_found" };
  const res = await transition(db, p.id, "cancelled", cc.user.id, "cancelled_by_student");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export type AdminActionError = "not_set_up" | "already_handled" | "reason_required" | "not_found" | "plan_duration_missing" | "error";

function adminError(e: TransitionErrorCode | "not_set_up"): AdminActionError {
  if (e === "invalid_transition") return "already_handled";
  if (e === "proof_required") return "error";
  return e;
}

export async function approvePayment(adminId: string, paymentId: string): Promise<{ ok: true } | { ok: false; error: AdminActionError }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "not_set_up" };
  if (!isUuid(paymentId)) return { ok: false, error: "not_found" };
  const res = await transition(db, paymentId, "paid", adminId);
  if (!res.ok) return { ok: false, error: adminError(res.error) };
  await notify(paymentId, "approved");
  return { ok: true };
}

export async function rejectPayment(adminId: string, paymentId: string, reasonEn: string, reasonAr: string): Promise<{ ok: true } | { ok: false; error: AdminActionError }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "not_set_up" };
  if (!isUuid(paymentId)) return { ok: false, error: "not_found" };
  const en = String(reasonEn ?? "").trim().slice(0, 500);
  const ar = String(reasonAr ?? "").trim().slice(0, 500);
  if (!en && !ar) return { ok: false, error: "reason_required" };
  const res = await transition(db, paymentId, "rejected", adminId, en || ar, ar || null);
  if (!res.ok) return { ok: false, error: adminError(res.error) };
  await notify(paymentId, "rejected");
  return { ok: true };
}

async function expireOne(db: Service, paymentId: string): Promise<boolean> {
  const res = await transition(db, paymentId, "expired", null, "reservation_expired");
  if (res.ok) await notify(paymentId, "expired");
  return res.ok;
}

// ─── cron ────────────────────────────────────────────────────────────────

export interface CronReport {
  expired: number;
  reminders7d: number;
  reminders1d: number;
  enrollmentsEnded: number;
}

/** awaiting_transfer past expires_at (48 h) -> expired (seat released by cc_cohort_seats), email. */
export async function runPaymentsCron(now: Date = new Date()): Promise<CronReport | { error: string }> {
  const db = createServiceClient();
  if (!db) return { error: "not_configured" };
  const report: CronReport = { expired: 0, reminders7d: 0, reminders1d: 0, enrollmentsEnded: 0 };

  const { data: due, error } = await db
    .from("cc_payments")
    .select("id")
    .eq("status", "awaiting_transfer")
    .lt("expires_at", now.toISOString())
    .order("expires_at")
    .limit(200);
  if (error) return { error: isMissingSchema(error.code) ? "run_0084" : "read_failed" };
  for (const p of (due ?? []) as { id: string }[]) if (await expireOne(db, p.id)) report.expired++;

  const in7 = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();
  const { data: ending } = await db
    .from("cc_enrollments")
    .select("id,user_id,plan_id,ends_at,status,reminder_7d_sent_at,reminder_1d_sent_at")
    .eq("status", "active")
    .gt("ends_at", now.toISOString())
    .lte("ends_at", in7)
    .limit(500);
  for (const e of (ending ?? []) as { id: string; user_id: string; plan_id: string | null; ends_at: string; status: string; reminder_7d_sent_at: string | null; reminder_1d_sent_at: string | null }[]) {
    const kind = reminderDue(e, now);
    if (!kind) continue;
    const sent = await sendReminder(db, e, kind);
    if (!sent) continue;
    // Mark both on the 1-day email so a late 7-day email never follows it.
    const stamp = now.toISOString();
    await db
      .from("cc_enrollments")
      .update(kind === "1d" ? { reminder_1d_sent_at: stamp, reminder_7d_sent_at: e.reminder_7d_sent_at ?? stamp } : { reminder_7d_sent_at: stamp })
      .eq("id", e.id);
    if (kind === "1d") report.reminders1d++;
    else report.reminders7d++;
  }

  const { data: ended } = await db.from("cc_enrollments").update({ status: "expired" }).eq("status", "active").lt("ends_at", now.toISOString()).select("id");
  report.enrollmentsEnded = (ended ?? []).length;
  return report;
}

// ─── emails ──────────────────────────────────────────────────────────────

interface Profile {
  email: string | null;
  full_name: string | null;
  preferred_locale: Locale | null;
}

const both = (fn: (l: Locale) => string) => ({ en: fn("en"), ar: fn("ar") });

async function loadEmailContext(paymentId: string): Promise<{ to: string | null; locale: Locale; data: PaymentEmailData; status: CcPaymentStatus } | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data: p } = await db.from("cc_payments").select("*").eq("id", paymentId).maybeSingle();
  if (!p) return null;
  const pay = p as Record<string, unknown> & { user_id: string; plan_id: string; cohort_id: string | null; reference_code: string; amount_qar: number; status: CcPaymentStatus };
  const [{ data: prof }, { data: plan }, cohortRes, enrollRes] = await Promise.all([
    db.from("cc_profiles").select("email,full_name,preferred_locale").eq("id", pay.user_id).maybeSingle<Profile>(),
    db.from("cc_plans").select("name_en,name_ar").eq("id", pay.plan_id).maybeSingle<{ name_en: string; name_ar: string }>(),
    pay.cohort_id
      ? db.from("cc_cohorts").select("name_en,name_ar,starts_on,ends_on,location_en,location_ar").eq("id", pay.cohort_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("cc_enrollments").select("ends_at").eq("payment_id", paymentId).maybeSingle<{ ends_at: string }>(),
  ]);
  const locale: Locale = prof?.preferred_locale === "ar" ? "ar" : "en";
  const site = defaultSiteUrl();
  const cohort = cohortRes.data as { name_en: string; name_ar: string; starts_on: string | null; ends_on: string | null; location_en: string | null; location_ar: string | null } | null;
  const fawran = getFawranDetails();
  const data: PaymentEmailData = {
    locale,
    name: prof?.full_name ?? null,
    planName: { en: plan?.name_en ?? "CAD Champions", ar: plan?.name_ar ?? plan?.name_en ?? "CAD Champions" },
    amount: both((l) => formatQAR(Number(pay.amount_qar), l)),
    referenceCode: pay.reference_code,
    url: `${site}${ccPath(locale, `/account/payments/${paymentId}`)}`,
    expiresAt: pay.expires_at ? both((l) => formatDateTime(String(pay.expires_at), l)) : null,
    activeUntil: enrollRes.data?.ends_at ? both((l) => formatDate(enrollRes.data!.ends_at, l)) : null,
    rejectReason: pay.reject_reason
      ? { en: String(pay.reject_reason), ar: String(pay.reject_reason_ar ?? pay.reject_reason) }
      : null,
    cohort: cohort
      ? {
          name: { en: cohort.name_en, ar: cohort.name_ar },
          dates: cohort.starts_on ? both((l) => `${formatDate(cohort.starts_on!, l)}${cohort.ends_on ? ` – ${formatDate(cohort.ends_on, l)}` : ""}`) : null,
          location: cohort.location_en || cohort.location_ar ? { en: cohort.location_en ?? cohort.location_ar ?? "", ar: cohort.location_ar ?? cohort.location_en ?? "" } : null,
        }
      : null,
    fawran,
    receiptUrl: `${site}/api/cad-champions/payments/${paymentId}/receipt?lang=${locale}`,
    trainingUrl: `${site}${ccPath(locale, "/training")}`,
  };
  return { to: prof?.email ?? null, locale, data, status: pay.status };
}

async function notify(paymentId: string, kind: PaymentEmailKind): Promise<void> {
  const ctx = await loadEmailContext(paymentId);
  if (!ctx) return;
  const data = kind === "approved" ? { ...ctx.data, url: ctx.data.trainingUrl ?? ctx.data.url } : kind === "expired" ? { ...ctx.data, url: `${defaultSiteUrl()}${ccPath(ctx.locale, "/training/join")}` } : ctx.data;
  // Fawran details (with the IBAN) go only in the reservation email.
  if (kind !== "reserved") data.fawran = null;
  await sendPaymentEmail(ctx.to, kind, data, `cc-pay-${kind}-${paymentId}${kind === "rejected" || kind === "proof_received" ? `-${Math.floor(Date.now() / 60_000)}` : ""}`);
}

async function sendReminder(db: Service, e: { id: string; user_id: string; plan_id: string | null; ends_at: string }, kind: "7d" | "1d"): Promise<boolean> {
  const [{ data: prof }, { data: plan }] = await Promise.all([
    db.from("cc_profiles").select("email,full_name,preferred_locale").eq("id", e.user_id).maybeSingle<Profile>(),
    e.plan_id ? db.from("cc_plans").select("name_en,name_ar").eq("id", e.plan_id).maybeSingle<{ name_en: string; name_ar: string }>() : Promise.resolve({ data: null }),
  ]);
  if (!prof?.email) return false;
  const locale: Locale = prof.preferred_locale === "ar" ? "ar" : "en";
  const p = plan as { name_en: string; name_ar: string } | null;
  return sendPaymentEmail(
    prof.email,
    kind === "1d" ? "reminder_1d" : "reminder_7d",
    {
      locale,
      name: prof.full_name,
      planName: { en: p?.name_en ?? "CAD Champions", ar: p?.name_ar ?? p?.name_en ?? "CAD Champions" },
      amount: { en: "", ar: "" },
      referenceCode: "",
      url: `${defaultSiteUrl()}${ccPath(locale, "/training/join")}`,
      activeUntil: both((l) => formatDate(e.ends_at, l)),
    },
    `cc-enroll-${kind}-${e.id}`,
  );
}

// ─── student + admin reads ───────────────────────────────────────────────

export interface PaymentView {
  id: string;
  user_id: string;
  status: CcPaymentStatus;
  method: CcPaymentMethod;
  reference_code: string;
  amount_qar: number;
  list_price_qar: number | null;
  discount_qar: number;
  addon_qar: number;
  created_at: string;
  expires_at: string | null;
  paid_at: string | null;
  proof_submitted_at: string | null;
  reject_reason: string | null;
  reject_reason_ar: string | null;
  receipt_number: number | null;
  payer_name: string | null;
  payer_bank: string | null;
  transfer_reference: string | null;
  transferred_at: string | null;
  proof_storage_path: string | null;
  plan: { id: string; name_en: string; name_ar: string; duration_days: number | null; kind: string } | null;
  addon: { name_en: string; name_ar: string } | null;
  cohort: { name_en: string; name_ar: string; starts_on: string | null; ends_on: string | null; location_en: string | null; location_ar: string | null } | null;
  enrollment: { starts_at: string; ends_at: string } | null;
}

const PAYMENT_SELECT =
  "*, plan:cc_plans!cc_payments_plan_id_fkey(id,name_en,name_ar,duration_days,kind), addon:cc_plans!cc_payments_addon_plan_id_fkey(name_en,name_ar), cohort:cc_cohorts(name_en,name_ar,starts_on,ends_on,location_en,location_ar)";

function toView(r: Record<string, unknown>, enrollment: { starts_at: string; ends_at: string } | null): PaymentView {
  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    status: r.status as CcPaymentStatus,
    method: r.method as CcPaymentMethod,
    reference_code: String(r.reference_code),
    amount_qar: Number(r.amount_qar),
    list_price_qar: r.list_price_qar == null ? null : Number(r.list_price_qar),
    discount_qar: Number(r.discount_qar ?? 0),
    addon_qar: Number(r.addon_qar ?? 0),
    created_at: String(r.created_at),
    expires_at: (r.expires_at as string | null) ?? null,
    paid_at: (r.paid_at as string | null) ?? null,
    proof_submitted_at: (r.proof_submitted_at as string | null) ?? null,
    reject_reason: (r.reject_reason as string | null) ?? null,
    reject_reason_ar: (r.reject_reason_ar as string | null) ?? null,
    receipt_number: r.receipt_number == null ? null : Number(r.receipt_number),
    payer_name: (r.payer_name as string | null) ?? null,
    payer_bank: (r.payer_bank as string | null) ?? null,
    transfer_reference: (r.transfer_reference as string | null) ?? null,
    transferred_at: (r.transferred_at as string | null) ?? null,
    proof_storage_path: (r.proof_storage_path as string | null) ?? null,
    plan: one(r.plan),
    addon: one(r.addon),
    cohort: one(r.cohort),
    enrollment,
  };
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: "not_set_up" | "error" };

export async function loadMyPayments(userId: string): Promise<Loaded<PaymentView[]>> {
  const db = createServiceClient();
  if (!db) return { ok: false, reason: "not_set_up" };
  const { data, error } = await db.from("cc_payments").select(PAYMENT_SELECT).eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) {
    if (!isMissingSchema(error.code)) console.error("[cc-payments] list failed:", error.code ?? error.message);
    return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
  }
  return { ok: true, value: ((data ?? []) as Record<string, unknown>[]).map((r) => toView(r, null)) };
}

/** One payment of the signed-in student (or any payment for staff when `asStaff`). */
export async function loadPayment(userId: string, paymentId: string, asStaff = false): Promise<Loaded<PaymentView | null>> {
  const db = createServiceClient();
  if (!db) return { ok: false, reason: "not_set_up" };
  if (!isUuid(paymentId)) return { ok: true, value: null };
  let q = db.from("cc_payments").select(PAYMENT_SELECT).eq("id", paymentId);
  if (!asStaff) q = q.eq("user_id", userId);
  const { data, error } = await q.maybeSingle();
  if (error) {
    if (!isMissingSchema(error.code)) console.error("[cc-payments] read failed:", error.code ?? error.message);
    return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
  }
  if (!data) return { ok: true, value: null };
  const { data: e } = await db.from("cc_enrollments").select("starts_at,ends_at").eq("payment_id", paymentId).maybeSingle<{ starts_at: string; ends_at: string }>();
  return { ok: true, value: toView(data as Record<string, unknown>, e ?? null) };
}

/** Our Fawran details for the signed-in Pay step (IBAN allowed there only). */
export function payDetails() {
  return getFawranDetails();
}

export interface AdminPaymentRow extends PaymentView {
  student: { name: string | null; email: string | null; phone: string | null };
  proofUrl: string | null;
  proofIsPdf: boolean;
}

export const ADMIN_STATUS_FILTERS = ["queue", "awaiting_transfer", "proof_submitted", "paid", "rejected", "expired", "cancelled", "refunded", "all"] as const;
export type AdminStatusFilter = (typeof ADMIN_STATUS_FILTERS)[number];

export async function loadAdminPayments(filter: AdminStatusFilter): Promise<Loaded<AdminPaymentRow[]>> {
  const db = createServiceClient();
  if (!db) return { ok: false, reason: "not_set_up" };
  let q = db.from("cc_payments").select(PAYMENT_SELECT).order("created_at", { ascending: false }).limit(200);
  if (filter === "queue") q = q.in("status", ["proof_submitted", "awaiting_transfer", "rejected"]);
  else if (filter !== "all") q = q.eq("status", filter);
  const { data, error } = await q;
  if (error) {
    if (!isMissingSchema(error.code)) console.error("[cc-payments] admin list failed:", error.code ?? error.message);
    return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const { data: profs } = userIds.length
    ? await db.from("cc_profiles").select("id,full_name,email,phone").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null; phone: string | null }[] };
  const byId = new Map(((profs ?? []) as { id: string; full_name: string | null; email: string | null; phone: string | null }[]).map((p) => [p.id, p]));

  const out: AdminPaymentRow[] = [];
  for (const r of rows) {
    const v = toView(r, null);
    let proofUrl: string | null = null;
    if (v.proof_storage_path) {
      const { data: signed } = await db.storage.from(PROOF_BUCKET).createSignedUrl(v.proof_storage_path, 600);
      proofUrl = signed?.signedUrl ?? null;
    }
    const prof = byId.get(String(r.user_id));
    out.push({
      ...v,
      student: { name: prof?.full_name ?? null, email: prof?.email ?? null, phone: prof?.phone ?? null },
      proofUrl,
      proofIsPdf: /\.pdf$/i.test(v.proof_storage_path ?? ""),
    });
  }
  return { ok: true, value: sortAdminQueue(out) };
}

// ─── SkipCash ────────────────────────────────────────────────────────────

/** Webhook: verify -> find ours -> fetch from SkipCash -> confirm amount + currency -> paid. Idempotent. */
export async function handleSkipCashWebhook(req: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = await parseSkipCashWebhook(req);
  if (!parsed.ok) return { status: parsed.status, body: { error: parsed.error } };
  const db = createServiceClient();
  if (!db) return { status: 503, body: { error: "unavailable" } };
  const ev = parsed.event;

  let { data: p } = await db.from("cc_payments").select("id,status,amount_qar,method,provider_payment_id").eq("provider_payment_id", ev.providerPaymentId).maybeSingle();
  if (!p && isUuid(ev.ourPaymentId)) {
    ({ data: p } = await db.from("cc_payments").select("id,status,amount_qar,method,provider_payment_id").eq("id", ev.ourPaymentId).maybeSingle());
  }
  const local = p as { id: string; status: string; amount_qar: number; method: string; provider_payment_id: string | null } | null;
  // Unknown payment: answer 200 so SkipCash stops retrying; nothing changes.
  if (!local || local.method !== "skipcash") return { status: 200, body: { ignored: "unknown_payment" } };
  if (local.status === "paid" || local.status === "refunded") return { status: 200, body: { ignored: "already_paid" } };

  const remote = await getSkipCashPayment(ev.providerPaymentId);
  const decision = decideWebhook({ status: local.status, amount_qar: Number(local.amount_qar) }, remote);
  if (decision.action === "mark_paid") {
    const res = await transition(db, local.id, "paid", null, null, null, {
      provider_payment_id: ev.providerPaymentId,
      provider_status: String(ev.statusId),
      raw_payload: ev.raw,
    });
    if (res.ok) await notify(local.id, "approved");
    return { status: 200, body: { ok: true } };
  }
  if (decision.action === "review") {
    await db.from("cc_audit_log").insert({
      actor_id: null,
      action: "payment.skipcash_review",
      entity_type: "cc_payment",
      entity_id: local.id,
      before: { status: local.status },
      after: { reason: decision.reason, statusId: ev.statusId, amount: ev.amount },
    });
  }
  await db.from("cc_payments").update({ provider_status: String(ev.statusId) }).eq("id", local.id).neq("status", "paid");
  return { status: 200, body: { ok: true, action: decision.action } };
}

/** The return page polls this: for SkipCash it also asks SkipCash directly (webhook may be late). */
export async function refreshPaymentStatus(cc: CcUser, paymentId: string): Promise<{ status: CcPaymentStatus } | null> {
  const db = createServiceClient();
  if (!db) return null;
  const p = await ownedPayment(db, cc.user.id, paymentId);
  if (!p) return null;
  if (p.method === "skipcash" && p.status === "awaiting_transfer" && p.provider_payment_id && isSkipCashEnabled()) {
    const remote = await getSkipCashPayment(p.provider_payment_id);
    if (decideWebhook({ status: p.status, amount_qar: Number(p.amount_qar) }, remote).action === "mark_paid") {
      const res = await transition(db, p.id, "paid", null, null, null, { provider_status: remote?.providerStatus ?? "2" });
      if (res.ok) {
        await notify(p.id, "approved");
        return { status: "paid" };
      }
    }
  }
  return { status: p.status };
}

/** Starts the hosted page again for an existing unpaid SkipCash payment. */
export function skipCashAvailable(): boolean {
  return isSkipCashEnabled();
}
