import { describe, expect, it } from "vitest";

import {
  couponStatus,
  endOfQatarDay,
  parseCohortInput,
  parseCouponInput,
  parsePlanInput,
  priceChanged,
  qatarDay,
  seatsBelowTaken,
  seatsLeftOf,
  splitLines,
} from "./plans-admin";

const PLAN_OK = { slug: "online", kind: "online", name_en: "Online", name_ar: "عبر الإنترنت", price_qar: "1250", duration_days: "90", includes_en: "A\nB", includes_ar: "أ\nب", is_active: "on" };

describe("parsePlanInput", () => {
  it("parses a valid plan", () => {
    const r = parsePlanInput(PLAN_OK, { creating: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ slug: "online", price_qar: 1250, duration_days: 90, includes_en: ["A", "B"], is_active: true, is_featured: false, includes_in_person: false });
  });
  it("allows a null price (Price coming soon) and rounds to 2 decimals", () => {
    const empty = parsePlanInput({ ...PLAN_OK, price_qar: "" }, { creating: false });
    expect(empty.ok && empty.value.price_qar).toBe(null);
    const dec = parsePlanInput({ ...PLAN_OK, price_qar: "99,999" }, { creating: false });
    expect(dec.ok && dec.value.price_qar).toBe(100);
  });
  it("rejects bad values with field codes", () => {
    const r = parsePlanInput({ slug: "Bad Slug", kind: "x", name_en: "", name_ar: " ", price_qar: "-1", duration_days: "0", includes_en: "A", includes_ar: "" }, { creating: true });
    expect(r).toEqual({ ok: false, errors: { slug: "slug", kind: "kind", name_en: "required", name_ar: "required", price_qar: "range", duration_days: "range", includes_ar: "same_count" } });
  });
  it("forces in-person for online_in_person and drops the duration of a kit", () => {
    const a = parsePlanInput({ ...PLAN_OK, kind: "online_in_person" }, { creating: false });
    expect(a.ok && a.value.includes_in_person).toBe(true);
    const k = parsePlanInput({ ...PLAN_OK, kind: "kit", duration_days: "90" }, { creating: false });
    expect(k.ok && k.value.duration_days).toBe(null);
  });
  it("only checks the slug when creating", () => {
    expect(parsePlanInput({ ...PLAN_OK, slug: "" }, { creating: false }).ok).toBe(true);
  });
  it("detects price changes", () => {
    expect(priceChanged("1000.00", 1000)).toBe(false);
    expect(priceChanged(null, null)).toBe(false);
    expect(priceChanged(null, 10)).toBe(true);
    expect(priceChanged(10, null)).toBe(true);
  });
  it("splits lines", () => {
    expect(splitLines(" a \n\n b ")).toEqual(["a", "b"]);
    expect(splitLines("x\n".repeat(30)).length).toBe(12);
  });
});

describe("parseCouponInput", () => {
  const OK = { code: " spring 26 ", discount_type: "percent", discount_value: "15", is_active: "on" };
  it("normalises the code to upper case without spaces", () => {
    const r = parseCouponInput(OK);
    expect(r.ok && r.value.code).toBe("SPRING26");
  });
  it("validates percent and fixed", () => {
    expect(parseCouponInput({ ...OK, discount_value: "101" })).toEqual({ ok: false, errors: { discount_value: "percent_max" } });
    expect(parseCouponInput({ ...OK, discount_type: "fixed", discount_value: "250" }).ok).toBe(true);
    expect(parseCouponInput({ ...OK, discount_value: "0" })).toEqual({ ok: false, errors: { discount_value: "range" } });
    expect(parseCouponInput({ ...OK, discount_value: "abc" })).toEqual({ ok: false, errors: { discount_value: "number" } });
    expect(parseCouponInput({ ...OK, discount_type: "x" })).toEqual({ ok: false, errors: { discount_type: "type" } });
  });
  it("validates code, expiry, max uses and plans", () => {
    expect(parseCouponInput({ ...OK, code: "a!" })).toMatchObject({ ok: false, errors: { code: "code" } });
    const e = parseCouponInput({ ...OK, expires_at: "2026-10-31", max_uses: "50", institution: " QU " });
    expect(e.ok && e.value).toMatchObject({ expires_at: "2026-10-31T20:59:59.000Z", max_uses: 50, institution: "QU", plan_ids: null });
    expect(parseCouponInput({ ...OK, expires_at: "31/10/2026" })).toEqual({ ok: false, errors: { expires_at: "date" } });
    expect(parseCouponInput({ ...OK, max_uses: "0" })).toEqual({ ok: false, errors: { max_uses: "range" } });
    const pid = "00000000-0000-4000-8000-0000000000a1";
    expect(parseCouponInput({ ...OK, plan_ids: [pid] }, { knownPlanIds: [pid] }).ok).toBe(true);
    expect(parseCouponInput({ ...OK, plan_ids: [pid] }, { knownPlanIds: [] })).toEqual({ ok: false, errors: { plan_ids: "unknown" } });
  });
  it("converts Qatar days both ways and reports the status", () => {
    expect(endOfQatarDay("2026-02-30")).toBeNull();
    expect(qatarDay("2026-10-31T20:59:59.000Z")).toBe("2026-10-31");
    const now = Date.parse("2026-10-14T00:00:00Z");
    const base = { is_active: true, expires_at: null, max_uses: null, used_count: 0 };
    expect(couponStatus(base, now)).toBe("active");
    expect(couponStatus({ ...base, is_active: false }, now)).toBe("inactive");
    expect(couponStatus({ ...base, expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("expired");
    expect(couponStatus({ ...base, max_uses: 2, used_count: 2 }, now)).toBe("used_up");
  });
});

describe("parseCohortInput", () => {
  const OK = { slug: "spring-27", name_en: "Spring", name_ar: "الربيع", starts_on: "2027-03-01", ends_on: "2027-04-30", seats_total: "20", status: "open" };
  it("parses a valid cohort", () => {
    const r = parseCohortInput(OK, { creating: true });
    expect(r.ok && r.value).toMatchObject({ slug: "spring-27", seats_total: 20, status: "open", schedule_en: null });
  });
  it("rejects bad dates, order, seats and status", () => {
    expect(parseCohortInput({ ...OK, starts_on: "2027-13-01" }, { creating: true })).toEqual({ ok: false, errors: { starts_on: "date" } });
    expect(parseCohortInput({ ...OK, ends_on: "2027-02-01" }, { creating: true })).toEqual({ ok: false, errors: { ends_on: "before_start" } });
    expect(parseCohortInput({ ...OK, seats_total: "-1", status: "nope" }, { creating: true })).toEqual({ ok: false, errors: { seats_total: "range", status: "status" } });
    expect(parseCohortInput({ ...OK, slug: "Bad Slug" }, { creating: true })).toEqual({ ok: false, errors: { slug: "slug" } });
  });
  it("computes seats", () => {
    expect(seatsLeftOf(10, 3)).toBe(7);
    expect(seatsLeftOf(2, 5)).toBe(0);
    expect(seatsBelowTaken(2, 3)).toBe(true);
    expect(seatsBelowTaken(3, 3)).toBe(false);
  });
});
