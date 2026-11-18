// Reference codes, coupons, plans/cohorts/enrollment rules, status display.
import { describe, expect, it } from "vitest";

import { checkCoupon, computeTotals, discountAmount, normalizeCouponCode, round2, type CouponRule } from "./coupon";
import { bankLabelKey } from "./banks";
import { canRenew, canSeePrices, cohortAvailability, daysLeft, isAddonAvailable, isPurchasable, needsCohort, reminderDue, reservationExpiry, seatsLeft } from "./plans";
import { REFERENCE_ALPHABET, generateReferenceCode, isReferenceCode, normalizeReferenceCode } from "./reference-code";
import { adminQueueRank, paymentSteps, sortAdminQueue, statusTone } from "./status";

describe("reference codes", () => {
  it("has no ambiguous characters", () => {
    for (const c of ["0", "O", "1", "I"]) expect(REFERENCE_ALPHABET).not.toContain(c);
    expect(REFERENCE_ALPHABET).toHaveLength(32);
  });

  it("generates CAD-XXXX codes from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferenceCode();
      expect(code).toMatch(/^CAD-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      expect(isReferenceCode(code)).toBe(true);
    }
  });

  it("is deterministic with injected bytes and maps every byte without bias", () => {
    expect(generateReferenceCode(4, () => new Uint8Array([0, 31, 32, 255]))).toBe("CAD-2Z2Z");
    expect(generateReferenceCode(5, (n) => new Uint8Array(n).fill(5))).toBe("CAD-77777");
  });

  it("clamps the length to 4..8", () => {
    expect(generateReferenceCode(1)).toHaveLength(8);
    expect(generateReferenceCode(20)).toHaveLength(12);
  });

  it("normalises what a student types", () => {
    expect(normalizeReferenceCode("cad-7k3p")).toBe("CAD-7K3P");
    expect(normalizeReferenceCode("7K3P")).toBe("CAD-7K3P");
    expect(normalizeReferenceCode("CAD 7K3P")).toBe("CAD-7K3P");
    expect(normalizeReferenceCode("CAD-0O1I")).toBeNull();
    expect(isReferenceCode("CAD-7K3")).toBe(false);
  });
});

const base: CouponRule = {
  code: "SCHOOL10",
  discount_type: "percent",
  discount_value: 10,
  expires_at: null,
  max_uses: null,
  used_count: 0,
  plan_ids: null,
  institution: null,
  is_active: true,
};

describe("coupons", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  it("accepts a valid code", () => {
    expect(checkCoupon(base, { planId: "p1", institution: null, now })).toEqual({ ok: true });
  });
  it("gives the reason it fails, in the SQL order", () => {
    expect(checkCoupon(null, { planId: "p1", institution: null, now })).toEqual({ ok: false, reason: "invalid" });
    expect(checkCoupon({ ...base, is_active: false }, { planId: "p1", institution: null, now })).toEqual({ ok: false, reason: "invalid" });
    expect(checkCoupon({ ...base, expires_at: "2026-10-14T09:59:59Z" }, { planId: "p1", institution: null, now })).toEqual({ ok: false, reason: "expired" });
    expect(checkCoupon({ ...base, max_uses: 5, used_count: 5 }, { planId: "p1", institution: null, now })).toEqual({ ok: false, reason: "used_up" });
    expect(checkCoupon({ ...base, plan_ids: ["p2"] }, { planId: "p1", institution: null, now })).toEqual({ ok: false, reason: "wrong_plan" });
    expect(checkCoupon({ ...base, institution: "Qatar University" }, { planId: "p1", institution: "HBKU", now })).toEqual({ ok: false, reason: "wrong_institution" });
    expect(checkCoupon({ ...base, institution: "Qatar University" }, { planId: "p1", institution: " qatar university ", now })).toEqual({ ok: true });
    expect(checkCoupon({ ...base, plan_ids: [] }, { planId: "p1", institution: null, now })).toEqual({ ok: true });
  });
  it("computes the discount, capped", () => {
    expect(discountAmount("percent", 10, 1250)).toBe(125);
    expect(discountAmount("percent", 150, 1250)).toBe(1250);
    expect(discountAmount("percent", 33.333, 99.99)).toBe(33.33);
    expect(discountAmount("fixed", 200, 150)).toBe(150);
    expect(discountAmount("fixed", 0, 150)).toBe(0);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
  it("totals: coupon on the plan only, then the add-on", () => {
    expect(computeTotals({ planPrice: 1000, coupon: { type: "percent", value: 10 }, addonPrice: 200 })).toEqual({ list: 1000, discount: 100, addon: 200, amount: 1100 });
    expect(computeTotals({ planPrice: 500 })).toEqual({ list: 500, discount: 0, addon: 0, amount: 500 });
    expect(normalizeCouponCode(" school 10 ")).toBe("SCHOOL10");
  });
});

describe("plans, cohorts, enrollment", () => {
  const online = { kind: "online", price_qar: 900, duration_days: 90, is_active: true };
  it("blocks checkout until price and days are set", () => {
    expect(isPurchasable(online)).toBe(true);
    expect(isPurchasable({ ...online, price_qar: null })).toBe(false);
    expect(isPurchasable({ ...online, price_qar: "0" })).toBe(false);
    expect(isPurchasable({ ...online, duration_days: null })).toBe(false);
    expect(isPurchasable({ ...online, is_active: false })).toBe(false);
    expect(isPurchasable({ ...online, kind: "kit" })).toBe(false);
    expect(isAddonAvailable({ kind: "kit", price_qar: 120, duration_days: null, is_active: true })).toBe(true);
    expect(isAddonAvailable({ kind: "kit", price_qar: null, duration_days: null, is_active: true })).toBe(false);
  });
  it("knows when a cohort is needed", () => {
    expect(needsCohort({ kind: "online_in_person" })).toBe(true);
    expect(needsCohort({ kind: "online", includes_in_person: true })).toBe(true);
    expect(needsCohort({ kind: "online" })).toBe(false);
  });
  it("shows prices only after a submitted test (staff always)", () => {
    expect(canSeePrices({ firstTestSubmittedAt: null, isStaff: false })).toBe(false);
    expect(canSeePrices({ firstTestSubmittedAt: "2026-10-01T00:00:00Z", isStaff: false })).toBe(true);
    expect(canSeePrices({ firstTestSubmittedAt: null, isStaff: true })).toBe(true);
  });
  it("marks full and closed cohorts", () => {
    expect(cohortAvailability({ status: "open", seats_total: 12 }, 11)).toBe("open");
    expect(cohortAvailability({ status: "open", seats_total: 12 }, 12)).toBe("full");
    expect(cohortAvailability({ status: "full", seats_total: 12 }, 3)).toBe("full");
    expect(cohortAvailability({ status: "closed", seats_total: 12 }, 0)).toBe("closed");
    expect(seatsLeft({ seats_total: 12 }, 15)).toBe(0);
  });
  it("holds a reservation for 48 hours", () => {
    expect(reservationExpiry(new Date("2026-10-14T10:00:00Z")).toISOString()).toBe("2026-10-16T10:00:00.000Z");
  });
  it("opens renewal under 14 days left", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    expect(daysLeft("2026-10-20T00:00:00Z", now)).toBe(6);
    expect(canRenew("2026-10-27T00:00:00Z", now)).toBe(true);
    expect(canRenew("2026-10-29T00:00:00Z", now)).toBe(false);
    expect(canRenew(null, now)).toBe(true);
  });
  it("sends the 7-day and 1-day reminders once each", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const e = { status: "active", ends_at: "2026-10-20T00:00:00Z", reminder_7d_sent_at: null, reminder_1d_sent_at: null };
    expect(reminderDue(e, now)).toBe("7d");
    expect(reminderDue({ ...e, reminder_7d_sent_at: "x" }, now)).toBeNull();
    expect(reminderDue({ ...e, ends_at: "2026-10-14T20:00:00Z" }, now)).toBe("1d");
    expect(reminderDue({ ...e, ends_at: "2026-10-14T20:00:00Z", reminder_1d_sent_at: "x" }, now)).toBeNull();
    expect(reminderDue({ ...e, ends_at: "2026-11-30T00:00:00Z" }, now)).toBeNull();
    expect(reminderDue({ ...e, status: "expired" }, now)).toBeNull();
  });
});

describe("status display", () => {
  it("maps statuses to stepper states and tones", () => {
    expect(paymentSteps("awaiting_transfer").transfer).toBe("current");
    expect(paymentSteps("proof_submitted").review).toBe("current");
    expect(paymentSteps("paid").active).toBe("done");
    expect(paymentSteps("expired").transfer).toBe("locked");
    expect(statusTone("paid")).toBe("success");
    expect(statusTone("rejected")).toBe("warning");
  });
  it("puts proofs first, oldest proof first", () => {
    const rows = [
      { id: "a", status: "awaiting_transfer" as const, created_at: "2026-10-10" },
      { id: "b", status: "proof_submitted" as const, created_at: "2026-10-09", proof_submitted_at: "2026-10-12" },
      { id: "c", status: "proof_submitted" as const, created_at: "2026-10-11", proof_submitted_at: "2026-10-11" },
      { id: "d", status: "paid" as const, created_at: "2026-10-13" },
    ];
    expect(sortAdminQueue(rows).map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
    expect(adminQueueRank("proof_submitted")).toBe(0);
  });
  it("reads stored bank values", () => {
    expect(bankLabelKey("qnb")).toEqual({ key: "qnb", other: null });
    expect(bankLabelKey("other: Lesha Bank")).toEqual({ key: null, other: "Lesha Bank" });
    expect(bankLabelKey(null)).toEqual({ key: null, other: null });
  });
});
