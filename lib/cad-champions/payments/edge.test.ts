// Extra edge cases: coupon maths, reservation expiry and enrollment dates
// around Qatar midnight (UTC+3, no DST). Complements pure.test.ts.
import { describe, expect, it } from "vitest";

import { CC_PAYMENT_STATUSES } from "../db/types";
import { formatDate, formatDateTime } from "../format";
import { checkCoupon, computeTotals, discountAmount, type CouponRule } from "./coupon";
import { RESERVATION_HOURS, canRenew, daysLeft, reminderDue, reservationExpiry } from "./plans";
import { OPEN_STATUSES, allowedTransitions, canTransition, isTerminal } from "./state-machine";

const rule: CouponRule = { code: "X", discount_type: "fixed", discount_value: 50, expires_at: null, max_uses: null, used_count: 0, plan_ids: null, institution: null, is_active: true };

describe("discountAmount edge cases", () => {
  it("never negative, never above the price", () => {
    expect(discountAmount("fixed", -10, 100)).toBe(0);
    expect(discountAmount("percent", -10, 100)).toBe(0);
    expect(discountAmount("percent", 100, 100)).toBe(100);
    expect(discountAmount("percent", 0, 100)).toBe(0);
    expect(discountAmount("fixed", 100, 100)).toBe(100);
    expect(discountAmount("fixed", 99.999, 1000)).toBe(100);
  });
  it("zero, negative, NaN and infinite inputs give 0", () => {
    expect(discountAmount("fixed", 50, 0)).toBe(0);
    expect(discountAmount("fixed", 50, -20)).toBe(0);
    expect(discountAmount("percent", 10, Number.NaN)).toBe(0);
    expect(discountAmount("percent", Number.NaN, 100)).toBe(0);
    expect(discountAmount("percent", 10, Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("rounds to 2 decimals", () => {
    expect(discountAmount("percent", 15, 33.33)).toBe(5);
    expect(discountAmount("percent", 12.5, 10.01)).toBe(1.25);
  });
});

describe("computeTotals edge cases", () => {
  it("a coupon bigger than the plan leaves only the add-on to pay", () => {
    expect(computeTotals({ planPrice: 100, coupon: { type: "fixed", value: 500 }, addonPrice: 40 })).toEqual({ list: 100, discount: 100, addon: 40, amount: 40 });
  });
  it("a 100 percent coupon without an add-on is free (amount 0, not negative)", () => {
    expect(computeTotals({ planPrice: 750, coupon: { type: "percent", value: 100 } }).amount).toBe(0);
    expect(computeTotals({ planPrice: 750, coupon: { type: "percent", value: 250 } }).amount).toBe(0);
  });
  it("the coupon never discounts the add-on", () => {
    expect(computeTotals({ planPrice: 0, coupon: { type: "percent", value: 50 }, addonPrice: 120 })).toEqual({ list: 0, discount: 0, addon: 120, amount: 120 });
  });
  it("negative plan or add-on prices are treated as 0", () => {
    expect(computeTotals({ planPrice: -50, addonPrice: -10 })).toEqual({ list: 0, discount: 0, addon: 0, amount: 0 });
  });
  it("null add-on and null coupon are fine; no float drift", () => {
    expect(computeTotals({ planPrice: 99.99, coupon: null, addonPrice: null })).toEqual({ list: 99.99, discount: 0, addon: 0, amount: 99.99 });
    expect(computeTotals({ planPrice: 0.1, addonPrice: 0.2 }).amount).toBe(0.3);
    expect(computeTotals({ planPrice: 199.99, coupon: { type: "percent", value: 33 }, addonPrice: 19.99 })).toEqual({ list: 199.99, discount: 66, addon: 19.99, amount: 153.98 });
  });
});

describe("checkCoupon edge cases", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  it("expires exactly at expires_at (inclusive)", () => {
    expect(checkCoupon({ ...rule, expires_at: "2026-10-14T10:00:00Z" }, { planId: "p", institution: null, now })).toEqual({ ok: false, reason: "expired" });
    expect(checkCoupon({ ...rule, expires_at: "2026-10-14T10:00:00.001Z" }, { planId: "p", institution: null, now })).toEqual({ ok: true });
  });
  it("a coupon valid until end of day Qatar works at 23:59 Qatar and is expired from midnight Qatar", () => {
    const eod = { ...rule, expires_at: "2026-10-14T21:00:00+00:00" }; // 15 Oct 00:00 Qatar
    expect(checkCoupon(eod, { planId: "p", institution: null, now: new Date("2026-10-14T20:59:59Z") })).toEqual({ ok: true });
    expect(checkCoupon(eod, { planId: "p", institution: null, now: new Date("2026-10-14T21:00:00Z") })).toEqual({ ok: false, reason: "expired" });
  });
  it("max_uses boundaries", () => {
    expect(checkCoupon({ ...rule, max_uses: 5, used_count: 4 }, { planId: "p", institution: null, now })).toEqual({ ok: true });
    expect(checkCoupon({ ...rule, max_uses: 0, used_count: 0 }, { planId: "p", institution: null, now })).toEqual({ ok: false, reason: "used_up" });
  });
  it("inactive wins over every other reason; expired wins over used_up", () => {
    const all = { ...rule, is_active: false, expires_at: "2020-01-01T00:00:00Z", max_uses: 1, used_count: 1 };
    expect(checkCoupon(all, { planId: "p", institution: null, now })).toEqual({ ok: false, reason: "invalid" });
    expect(checkCoupon({ ...all, is_active: true }, { planId: "p", institution: null, now })).toEqual({ ok: false, reason: "expired" });
  });
  it("blank institution on the coupon means any institution; a restricted coupon fails without a student institution", () => {
    expect(checkCoupon({ ...rule, institution: "   " }, { planId: "p", institution: null, now })).toEqual({ ok: true });
    expect(checkCoupon({ ...rule, institution: "HBKU" }, { planId: "p", institution: null, now })).toEqual({ ok: false, reason: "wrong_institution" });
  });
});

describe("reservation expiry around Qatar midnight", () => {
  it("is exactly 48 hours, a fixed duration (no DST shift)", () => {
    expect(RESERVATION_HOURS).toBe(48);
    const at = new Date("2026-03-28T20:30:00Z");
    expect(reservationExpiry(at).getTime() - at.getTime()).toBe(48 * 3_600_000);
  });
  it("a reservation made at 23:30 Qatar expires at 23:30 Qatar two days later", () => {
    const at = new Date("2026-10-14T20:30:00Z"); // 23:30 Qatar, 14 Oct
    const exp = reservationExpiry(at);
    expect(exp.toISOString()).toBe("2026-10-16T20:30:00.000Z");
    expect(formatDateTime(exp, "en")).toContain("October 16, 2026");
    expect(formatDateTime(exp, "en")).toContain("23:30");
  });
  it("a reservation made at Qatar midnight shows the next Qatar day", () => {
    const at = new Date("2026-10-14T21:00:00Z"); // 00:00 on 15 Oct Qatar
    expect(formatDate(at, "en")).toBe("October 15, 2026");
    expect(formatDate(new Date(at.getTime() - 1), "en")).toBe("October 14, 2026");
    expect(formatDate(reservationExpiry(at), "en")).toBe("October 17, 2026");
  });
  it("uses the current time by default", () => {
    const before = Date.now();
    const exp = reservationExpiry().getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 48 * 3_600_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 48 * 3_600_000);
  });
});

describe("daysLeft / renew / reminders at boundaries", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  it("rounds partial days up and floors at 0", () => {
    expect(daysLeft("2026-10-14T00:00:01Z", now)).toBe(1);
    expect(daysLeft("2026-10-15T00:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-10-15T00:00:01Z", now)).toBe(2);
    expect(daysLeft("2026-10-14T00:00:00Z", now)).toBe(0);
    expect(daysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
  });
  it("renewal opens with 13 whole days left; 13 days and a few seconds still counts as 14", () => {
    expect(canRenew("2026-10-28T00:00:00Z", now)).toBe(false); // exactly 14 days
    expect(canRenew("2026-10-27T23:59:59Z", now)).toBe(false); // rounds up to 14
    expect(canRenew("2026-10-27T00:00:00Z", now)).toBe(true); // exactly 13 days
  });
  it("an ended enrollment can renew", () => {
    expect(canRenew("2026-10-01T00:00:00Z", now)).toBe(true);
  });
  it("reminders: 7d window starts at exactly 7 days, 1d at exactly 24 h, none at or after the end", () => {
    const e = { status: "active", ends_at: "", reminder_7d_sent_at: null, reminder_1d_sent_at: null };
    expect(reminderDue({ ...e, ends_at: "2026-10-21T00:00:00Z" }, now)).toBe("7d");
    expect(reminderDue({ ...e, ends_at: "2026-10-21T00:00:01Z" }, now)).toBeNull();
    expect(reminderDue({ ...e, ends_at: "2026-10-15T00:00:00Z" }, now)).toBe("1d");
    expect(reminderDue({ ...e, ends_at: "2026-10-14T00:00:00Z" }, now)).toBeNull();
  });
  it("1 day reminder wins over 7 day and never falls back to it once sent", () => {
    const e = { status: "active", ends_at: "2026-10-14T12:00:00Z", reminder_7d_sent_at: "x", reminder_1d_sent_at: null };
    expect(reminderDue(e, now)).toBe("1d");
    expect(reminderDue({ ...e, reminder_1d_sent_at: "y" }, now)).toBeNull();
  });
});

describe("payment state machine: structural invariants", () => {
  it("open statuses can still move; terminal ones have no way out for either method", () => {
    for (const s of OPEN_STATUSES) expect(isTerminal(s)).toBe(false);
    for (const s of ["refunded", "expired", "cancelled"] as const) expect(allowedTransitions(s, "skipcash")).toEqual([]);
  });
  it("a rejected proof can never be paid directly, even for SkipCash", () => {
    expect(canTransition("rejected", "paid", "skipcash")).toBe(false);
    expect(canTransition("proof_submitted", "awaiting_transfer")).toBe(false);
  });
  it("only paid can be refunded", () => {
    for (const s of CC_PAYMENT_STATUSES) expect(canTransition(s, "refunded")).toBe(s === "paid");
  });
  it("expiry and cancellation are only reachable before a proof exists", () => {
    for (const s of CC_PAYMENT_STATUSES) {
      expect(canTransition(s, "expired")).toBe(s === "awaiting_transfer");
      expect(canTransition(s, "cancelled")).toBe(s === "awaiting_transfer");
    }
  });
  it("allowedTransitions returns a copy callers cannot use to mutate the table", () => {
    const a = allowedTransitions("awaiting_transfer");
    a.push("paid");
    expect(canTransition("awaiting_transfer", "paid")).toBe(false);
  });
});
