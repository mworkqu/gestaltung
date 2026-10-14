// Plans, coupons and cohorts admin (Prompt 11 Step B) — PURE: parsing and
// validating the form input into DB payloads, plus small status helpers.
// The reads / writes are plans-admin-server.ts and the page actions.
// Rules mirror the table checks in 0077 / 0084 (and payments/coupon.ts).

import { CC_COHORT_STATUSES, CC_PLAN_KINDS, type CcCohortStatus, type CcDiscountType, type CcPlanKind } from "../db/types";
import { normalizeCouponCode } from "../payments/coupon";

type Raw = Record<string, unknown>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUPON_CODE = /^[A-Z0-9_-]{3,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const PLAN_PRICE_MAX = 1_000_000;
export const DURATION_MAX_DAYS = 3650;
export const INCLUDES_MAX_ITEMS = 12;
export const SEATS_MAX = 1000;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const optStr = (v: unknown, max: number): string | null => str(v, max) || null;
const bool = (v: unknown): boolean => v === true || v === "true" || v === "on" || v === "1";

function numOrNull(v: unknown): number | null | "bad" {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim().replace(",", ".");
    if (t === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(t)) return "bad";
    return Number(t);
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : "bad";
  return "bad";
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** One list item per line, trimmed, blanks dropped, capped. */
export function splitLines(v: unknown, maxItems = INCLUDES_MAX_ITEMS, maxLen = 200): string[] {
  const raw = Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" ? v.split(/\r?\n/) : [];
  return raw.map((l) => l.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

// ---------------------------------------------------------------- plans

export interface PlanInput {
  slug: string;
  kind: CcPlanKind;
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

export type PlanField = "slug" | "kind" | "name_en" | "name_ar" | "price_qar" | "duration_days" | "sort" | "includes_en" | "includes_ar";

export function parsePlanInput(raw: Raw, opts: { creating: boolean }): { ok: true; value: PlanInput } | { ok: false; errors: FieldErrors<PlanField> } {
  const errors: FieldErrors<PlanField> = {};
  const slug = str(raw.slug, 60).toLowerCase();
  if (opts.creating && !SLUG.test(slug)) errors.slug = "slug";
  const kind = (CC_PLAN_KINDS as readonly string[]).includes(String(raw.kind)) ? (raw.kind as CcPlanKind) : null;
  if (!kind) errors.kind = "kind";
  const name_en = str(raw.name_en, 120);
  const name_ar = str(raw.name_ar, 120);
  if (!name_en) errors.name_en = "required";
  if (!name_ar) errors.name_ar = "required";

  const priceRaw = numOrNull(raw.price_qar);
  let price: number | null = null;
  if (priceRaw === "bad") errors.price_qar = "number";
  else if (priceRaw != null) {
    if (priceRaw < 0 || priceRaw > PLAN_PRICE_MAX) errors.price_qar = "range";
    else price = round2(priceRaw);
  }

  const durRaw = numOrNull(raw.duration_days);
  let duration: number | null = null;
  if (kind !== "kit") {
    if (durRaw === "bad") errors.duration_days = "number";
    else if (durRaw != null) {
      if (!Number.isInteger(durRaw) || durRaw < 1 || durRaw > DURATION_MAX_DAYS) errors.duration_days = "range";
      else duration = durRaw;
    }
  }

  const sortRaw = numOrNull(raw.sort);
  let sort = 0;
  if (sortRaw === "bad" || (sortRaw != null && (!Number.isInteger(sortRaw) || Math.abs(sortRaw) > 100000))) errors.sort = "number";
  else if (sortRaw != null) sort = sortRaw;

  const includes_en = splitLines(raw.includes_en);
  const includes_ar = splitLines(raw.includes_ar);
  if (includes_en.length !== includes_ar.length) {
    errors.includes_ar = "same_count";
  }

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      kind,
      name_en,
      name_ar,
      who_for_en: optStr(raw.who_for_en, 400),
      who_for_ar: optStr(raw.who_for_ar, 400),
      includes_en,
      includes_ar,
      price_qar: price,
      duration_days: duration,
      includes_in_person: kind === "online_in_person" ? true : bool(raw.includes_in_person),
      is_featured: bool(raw.is_featured),
      is_active: bool(raw.is_active),
      sort,
    },
  };
}

/** A price change worth an audit row (null counts as "Price coming soon"). */
export function priceChanged(before: number | string | null | undefined, after: number | null): boolean {
  const b = before == null || before === "" ? null : Number(before);
  return b !== after;
}

// ---------------------------------------------------------------- coupons

export interface CouponInput {
  code: string;
  discount_type: CcDiscountType;
  discount_value: number;
  expires_at: string | null;
  max_uses: number | null;
  plan_ids: string[] | null;
  institution: string | null;
  is_active: boolean;
}

export type CouponField = "code" | "discount_type" | "discount_value" | "expires_at" | "max_uses" | "plan_ids";

const QATAR = "+03:00";

/** A real calendar day written YYYY-MM-DD (rejects 2026-02-30 without throwing). */
export function isRealDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD -> the end of that Qatar day as ISO UTC (the coupon works through the whole day). */
export function endOfQatarDay(day: string): string | null {
  if (!isRealDay(day)) return null;
  return new Date(`${day}T23:59:59${QATAR}`).toISOString();
}

/** The Qatar calendar day (YYYY-MM-DD) of an ISO timestamp, for the date input. */
export function qatarDay(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function parseCouponInput(raw: Raw, opts: { knownPlanIds?: readonly string[] } = {}): { ok: true; value: CouponInput } | { ok: false; errors: FieldErrors<CouponField> } {
  const errors: FieldErrors<CouponField> = {};
  const code = normalizeCouponCode(str(raw.code, 60));
  if (!COUPON_CODE.test(code)) errors.code = "code";
  const type: CcDiscountType | null = raw.discount_type === "percent" || raw.discount_type === "fixed" ? raw.discount_type : null;
  if (!type) errors.discount_type = "type";

  const v = numOrNull(raw.discount_value);
  let value = 0;
  if (v === "bad" || v == null) errors.discount_value = v == null ? "required" : "number";
  else if (v <= 0) errors.discount_value = "range";
  else if (type === "percent" && v > 100) errors.discount_value = "percent_max";
  else if (v > 100000) errors.discount_value = "range";
  else value = round2(v);

  let expires: string | null = null;
  const expRaw = str(raw.expires_at, 20);
  if (expRaw) {
    expires = endOfQatarDay(expRaw);
    if (!expires) errors.expires_at = "date";
  }

  const mu = numOrNull(raw.max_uses);
  let maxUses: number | null = null;
  if (mu === "bad" || (mu != null && (!Number.isInteger(mu) || mu < 1 || mu > 1_000_000))) errors.max_uses = "range";
  else maxUses = mu;

  let planIds: string[] | null = null;
  const pidsRaw = Array.isArray(raw.plan_ids) ? raw.plan_ids : [];
  const pids = [...new Set(pidsRaw.map(String))];
  if (pids.length > 0) {
    if (pids.some((p) => !UUID.test(p)) || (opts.knownPlanIds && pids.some((p) => !opts.knownPlanIds!.includes(p)))) errors.plan_ids = "unknown";
    else planIds = pids;
  }

  if (Object.keys(errors).length > 0 || !type) return { ok: false, errors };
  return { ok: true, value: { code, discount_type: type, discount_value: value, expires_at: expires, max_uses: maxUses, plan_ids: planIds, institution: optStr(raw.institution, 120), is_active: bool(raw.is_active) } };
}

export type CouponStatus = "active" | "inactive" | "expired" | "used_up";

export function couponStatus(c: { is_active: boolean; expires_at: string | null; max_uses: number | null; used_count: number }, now: number): CouponStatus {
  if (!c.is_active) return "inactive";
  if (c.expires_at && Date.parse(c.expires_at) <= now) return "expired";
  if (c.max_uses != null && c.used_count >= c.max_uses) return "used_up";
  return "active";
}

// ---------------------------------------------------------------- cohorts

export interface CohortInput {
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
  status: CcCohortStatus;
}

export type CohortField = "slug" | "name_en" | "name_ar" | "starts_on" | "ends_on" | "seats_total" | "status";

const validDay = isRealDay;

export function parseCohortInput(raw: Raw, opts: { creating: boolean }): { ok: true; value: CohortInput } | { ok: false; errors: FieldErrors<CohortField> } {
  const errors: FieldErrors<CohortField> = {};
  const slug = str(raw.slug, 60).toLowerCase();
  if (opts.creating && !SLUG.test(slug)) errors.slug = "slug";
  const name_en = str(raw.name_en, 120);
  const name_ar = str(raw.name_ar, 120);
  if (!name_en) errors.name_en = "required";
  if (!name_ar) errors.name_ar = "required";
  const starts = str(raw.starts_on, 10);
  const ends = str(raw.ends_on, 10);
  if (starts && !validDay(starts)) errors.starts_on = "date";
  if (ends && !validDay(ends)) errors.ends_on = "date";
  if (!errors.starts_on && !errors.ends_on && starts && ends && ends < starts) errors.ends_on = "before_start";
  const seats = numOrNull(raw.seats_total);
  let seatsTotal = 0;
  if (seats === "bad" || seats == null || !Number.isInteger(seats) || seats < 0 || seats > SEATS_MAX) errors.seats_total = "range";
  else seatsTotal = seats;
  const status = (CC_COHORT_STATUSES as readonly string[]).includes(String(raw.status)) ? (raw.status as CcCohortStatus) : null;
  if (!status) errors.status = "status";
  if (Object.keys(errors).length > 0 || !status) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      name_en,
      name_ar,
      starts_on: starts || null,
      ends_on: ends || null,
      schedule_en: optStr(raw.schedule_en, 400),
      schedule_ar: optStr(raw.schedule_ar, 400),
      location_en: optStr(raw.location_en, 200),
      location_ar: optStr(raw.location_ar, 200),
      seats_total: seatsTotal,
      status,
    },
  };
}

/** Seats left (never below 0); a cohort with 0 total seats is "unlimited" only if you read it so, so show it as 0. */
export function seatsLeftOf(total: number, taken: number): number {
  return Math.max(0, total - Math.max(0, taken));
}

/** The seat total may not drop below the seats already taken or held. */
export function seatsBelowTaken(total: number, taken: number): boolean {
  return total < taken;
}
