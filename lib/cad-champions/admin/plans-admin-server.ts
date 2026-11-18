// Plans, coupons and cohorts — SERVER ONLY (service role). The CALLER (a
// server action) has already passed adminGuard("admin"). Writes audit rows:
// plan.create / plan.update / plan.price_change (before + after price),
// coupon.create / coupon.update, cohort.create / cohort.update.

import type { CcCohort, CcCoupon, CcPlan } from "../db/types";
import {
  parseCohortInput,
  parseCouponInput,
  parsePlanInput,
  priceChanged,
  seatsBelowTaken,
  type CohortField,
  type CouponField,
  type FieldErrors,
  type PlanField,
} from "./plans-admin";
import { isMissingSchema, writeAudit, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/plans-admin-server.ts is server-only");

export interface PlansData {
  plans: CcPlan[];
  coupons: CcCoupon[];
  cohorts: CcCohort[];
  /** cohort id -> seats taken or held (cc_cohort_seats). */
  seats: Record<string, number>;
}

export async function loadPlansData(db: AdminDb): Promise<{ ok: true; data: PlansData } | { ok: false; reason: "not_set_up" | "error" }> {
  try {
    const [plans, coupons, cohorts, seats] = await Promise.all([
      db.from("cc_plans").select("*").order("sort").order("created_at"),
      db.from("cc_coupons").select("*").order("created_at", { ascending: false }),
      db.from("cc_cohorts").select("*").order("starts_on", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false }),
      db.rpc("cc_cohort_seats"),
    ]);
    for (const r of [plans, coupons, cohorts]) {
      if (r.error) return { ok: false, reason: isMissingSchema(r.error.code) ? "not_set_up" : "error" };
    }
    const taken: Record<string, number> = {};
    // The seats RPC arrives in 0083/0084; before it exists the page still works (0 taken).
    if (!seats.error) for (const s of (seats.data ?? []) as { cohort_id: string; seats_taken: number }[]) taken[s.cohort_id] = s.seats_taken;
    return { ok: true, data: { plans: (plans.data ?? []) as CcPlan[], coupons: (coupons.data ?? []) as CcCoupon[], cohorts: (cohorts.data ?? []) as CcCohort[], seats: taken } };
  } catch (e) {
    console.error("[cc-admin] plans read failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export type SaveFail<K extends string> = { ok: false; error: "invalid" | "not_set_up" | "not_found" | "conflict" | "error"; fields?: FieldErrors<K> };
export type SaveOk = { ok: true; id: string };

function dbFail<K extends string>(code: string | undefined): SaveFail<K> {
  if (code === "23505") return { ok: false, error: "conflict" };
  if (isMissingSchema(code)) return { ok: false, error: "not_set_up" };
  return { ok: false, error: "error" };
}

type Raw = Record<string, unknown>;

export async function savePlan(db: AdminDb, actorId: string, id: string | null, raw: Raw): Promise<SaveOk | SaveFail<PlanField>> {
  const parsed = parsePlanInput(raw, { creating: !id });
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.errors };
  const v = parsed.value;
  if (!id) {
    const { data, error } = await db.from("cc_plans").insert(v).select("*").single<CcPlan>();
    if (error || !data) {
      console.error("[cc-admin] plan insert failed:", error?.code ?? error?.message);
      return dbFail(error?.code);
    }
    await writeAudit(db, actorId, "plan.create", "cc_plans", data.id, null, v);
    return { ok: true, id: data.id };
  }
  const { data: before, error: be } = await db.from("cc_plans").select("*").eq("id", id).maybeSingle<CcPlan>();
  if (be) return dbFail(be.code);
  if (!before) return { ok: false, error: "not_found" };
  const { slug: _slug, ...patch } = v;
  void _slug;
  const { error } = await db.from("cc_plans").update(patch).eq("id", id);
  if (error) {
    console.error("[cc-admin] plan update failed:", error.code ?? error.message);
    return dbFail(error.code);
  }
  if (priceChanged(before.price_qar, v.price_qar)) {
    await writeAudit(db, actorId, "plan.price_change", "cc_plans", id, { price_qar: before.price_qar == null ? null : Number(before.price_qar), slug: before.slug }, { price_qar: v.price_qar, slug: before.slug });
  }
  await writeAudit(db, actorId, "plan.update", "cc_plans", id, pickPlan(before), patch);
  return { ok: true, id };
}

function pickPlan(p: CcPlan) {
  return {
    kind: p.kind,
    name_en: p.name_en,
    name_ar: p.name_ar,
    who_for_en: p.who_for_en,
    who_for_ar: p.who_for_ar,
    includes_en: p.includes_en,
    includes_ar: p.includes_ar,
    price_qar: p.price_qar == null ? null : Number(p.price_qar),
    duration_days: p.duration_days,
    includes_in_person: p.includes_in_person,
    is_featured: p.is_featured,
    is_active: p.is_active,
    sort: p.sort,
  };
}

export async function saveCoupon(db: AdminDb, actorId: string, id: string | null, raw: Raw): Promise<SaveOk | SaveFail<CouponField>> {
  const { data: planRows, error: pe } = await db.from("cc_plans").select("id");
  if (pe) return dbFail(pe.code);
  const parsed = parseCouponInput(raw, { knownPlanIds: ((planRows ?? []) as { id: string }[]).map((p) => p.id) });
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.errors };
  const v = parsed.value;
  if (!id) {
    const { data, error } = await db.from("cc_coupons").insert(v).select("id").single<{ id: string }>();
    if (error || !data) {
      console.error("[cc-admin] coupon insert failed:", error?.code ?? error?.message);
      return error?.code === "23505" ? { ok: false, error: "conflict", fields: { code: "taken" } } : dbFail(error?.code);
    }
    await writeAudit(db, actorId, "coupon.create", "cc_coupons", data.id, null, v);
    return { ok: true, id: data.id };
  }
  const { data: before, error: be } = await db.from("cc_coupons").select("*").eq("id", id).maybeSingle<CcCoupon>();
  if (be) return dbFail(be.code);
  if (!before) return { ok: false, error: "not_found" };
  // used_count is read-only here (the payment flow owns it)
  const { error } = await db.from("cc_coupons").update(v).eq("id", id);
  if (error) {
    console.error("[cc-admin] coupon update failed:", error.code ?? error.message);
    return error.code === "23505" ? { ok: false, error: "conflict", fields: { code: "taken" } } : dbFail(error.code);
  }
  await writeAudit(db, actorId, "coupon.update", "cc_coupons", id, {
    code: before.code,
    discount_type: before.discount_type,
    discount_value: Number(before.discount_value),
    expires_at: before.expires_at,
    max_uses: before.max_uses,
    plan_ids: before.plan_ids,
    institution: before.institution,
    is_active: before.is_active,
  }, v);
  return { ok: true, id };
}

export async function saveCohort(db: AdminDb, actorId: string, id: string | null, raw: Raw): Promise<SaveOk | SaveFail<CohortField>> {
  const parsed = parseCohortInput(raw, { creating: !id });
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.errors };
  const v = parsed.value;
  if (!id) {
    const { data, error } = await db.from("cc_cohorts").insert(v).select("id").single<{ id: string }>();
    if (error || !data) {
      console.error("[cc-admin] cohort insert failed:", error?.code ?? error?.message);
      return error?.code === "23505" ? { ok: false, error: "conflict", fields: { slug: "taken" } } : dbFail(error?.code);
    }
    await writeAudit(db, actorId, "cohort.create", "cc_cohorts", data.id, null, v);
    return { ok: true, id: data.id };
  }
  const { data: before, error: be } = await db.from("cc_cohorts").select("*").eq("id", id).maybeSingle<CcCohort>();
  if (be) return dbFail(be.code);
  if (!before) return { ok: false, error: "not_found" };
  const seats = await db.rpc("cc_cohort_seats");
  const taken = !seats.error ? (((seats.data ?? []) as { cohort_id: string; seats_taken: number }[]).find((s) => s.cohort_id === id)?.seats_taken ?? 0) : 0;
  if (seatsBelowTaken(v.seats_total, taken)) return { ok: false, error: "invalid", fields: { seats_total: "below_taken" } };
  const { slug: _slug, ...patch } = v;
  void _slug;
  const { error } = await db.from("cc_cohorts").update(patch).eq("id", id);
  if (error) {
    console.error("[cc-admin] cohort update failed:", error.code ?? error.message);
    return dbFail(error.code);
  }
  await writeAudit(db, actorId, "cohort.update", "cc_cohorts", id, {
    name_en: before.name_en,
    name_ar: before.name_ar,
    starts_on: before.starts_on,
    ends_on: before.ends_on,
    schedule_en: before.schedule_en,
    schedule_ar: before.schedule_ar,
    location_en: before.location_en,
    location_ar: before.location_ar,
    seats_total: before.seats_total,
    status: before.status,
  }, patch);
  return { ok: true, id };
}
