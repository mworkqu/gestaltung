import { describe, expect, it } from "vitest";

import { orderUpdateFor, planPromiseReview, reportLine, shippingInputs, type PromiseItemRow } from "@/lib/store/delivery-promises";
import { addWorkingDays, type Holidays } from "@/lib/store/working-days";

// Same calendar working-days.test.ts uses: Qatar Fri + Sat weekend, National Day 18 + 19 Dec.
const QA: Holidays = { weekend: [5, 6], dates: ["2026-12-18", "2026-12-19"] };
const CFG = { handling_days: 1, buffer_days: 3, tiers: { standard: { transit_days: 3 }, express: { transit_days: 1 } } };

const item = (id: string, sold: string | null, current: string | null | undefined): PromiseItemRow => ({
  id,
  part_name: `part ${id}`,
  lead_time_class: sold,
  part: current === undefined ? null : { lead_time_class: current },
});
const order = (over: Partial<{ created_at: string; promised_date: string; shipping_tier: string | null }> = {}) => ({
  created_at: "2026-12-17T08:00:00Z",
  promised_date: "2026-12-20",
  shipping_tier: "standard",
  ...over,
});

describe("shippingInputs", () => {
  it("reads the tier's transit days, defaulting like order_delivery_quote (handling 1, buffer 3, transit 0)", () => {
    expect(shippingInputs(CFG, "standard")).toEqual({ handlingDays: 1, transitDays: 3, bufferDays: 3 });
    expect(shippingInputs(CFG, "express").transitDays).toBe(1);
    expect(shippingInputs(CFG, null).transitDays).toBe(3); // null tier = standard
    expect(shippingInputs(CFG, "unknown").transitDays).toBe(0);
    expect(shippingInputs({}, "standard")).toEqual({ handlingDays: 1, transitDays: 0, bufferDays: 3 });
  });
});

describe("planPromiseReview", () => {
  it("is null when no datable line changed", () => {
    expect(planPromiseReview(order(), [item("a", "in_stock", "in_stock")], CFG, QA)).toBeNull();
    expect(planPromiseReview(order(), [item("a", null, "in_stock")], CFG, QA)).toBeNull();
  });

  it("falls back to the snapshot when the part is gone (join is null)", () => {
    expect(planPromiseReview(order(), [item("a", "in_stock", undefined)], CFG, QA)).toBeNull();
  });

  it("re-quotes in Qatar working days: Thu 2026-12-17 + 7 working days = Mon 2026-12-28", () => {
    // in_stock = 2 supplier days (calendar) -> Sat 19 Dec, then handling 1 + transit 3 + buffer 3 = 7 working days:
    // Sun 20, Mon 21, Tue 22, Wed 23, Thu 24, Sun 27, Mon 28. Same Monday as the working-days example.
    expect(addWorkingDays("2026-12-17", 7, QA)).toBe("2026-12-28");
    const plan = planPromiseReview(
      order({ promised_date: "2026-12-20" }),
      [item("a", "2_4_weeks", "in_stock")],
      CFG,
      QA,
    );
    // The recomputed date is 28 Dec (later than the 20th promised), so it moves.
    expect(plan).toMatchObject({ oldDate: "2026-12-20", newDate: "2026-12-28" });
    expect(plan?.changed.map((c) => c.id)).toEqual(["a"]);
    expect(plan?.itemUpdates).toEqual([{ id: "a", lead_time_class: "in_stock" }]);
  });

  it("without a holidays row the same order is quoted in calendar days (pre-0054)", () => {
    const plan = planPromiseReview(order({ promised_date: "2026-12-18" }), [item("a", "2_4_weeks", "in_stock")], CFG, null);
    expect(plan?.newDate).toBe("2026-12-26"); // 17 Dec + 2 supplier + 7 calendar days
  });

  it("never moves the date earlier; keeps the old date", () => {
    const plan = planPromiseReview(order({ promised_date: "2027-01-31" }), [item("a", "2_4_weeks", "in_stock")], CFG, QA);
    expect(plan).toMatchObject({ oldDate: "2027-01-31", newDate: "2027-01-31" });
  });

  it("a dated line that lost its offer gives a null date; only changed lines are listed", () => {
    const plan = planPromiseReview(
      order(),
      [item("a", "in_stock", null), item("b", "in_stock", "in_stock"), item("c", null, null)],
      CFG,
      QA,
    );
    expect(plan?.newDate).toBeNull();
    expect(plan?.changed.map((c) => c.id)).toEqual(["a"]);
    expect(plan?.itemUpdates).toEqual([{ id: "a", lead_time_class: null }]);
  });

  it("uses the order's shipping tier for transit days", () => {
    // express: 1 + 1 + 3 = 5 working days after Sat 19 Dec (17 Dec + 2): Sun 20 … Thu 24.
    const plan = planPromiseReview(order({ shipping_tier: "express", promised_date: "2026-12-18" }), [item("a", "2_4_weeks", "in_stock")], CFG, QA);
    expect(plan?.newDate).toBe("2026-12-24");
  });
});

describe("orderUpdateFor", () => {
  const now = new Date("2026-12-17T10:00:00Z");
  it("moves the date and stamps the notice when later", () => {
    expect(orderUpdateFor({ oldDate: "2026-12-20", newDate: "2026-12-28" }, now)).toEqual({
      promised_date: "2026-12-28",
      delay_notified_at: "2026-12-17T10:00:00.000Z",
    });
  });
  it("only stamps the notice when the date was lost", () => {
    expect(orderUpdateFor({ oldDate: "2026-12-20", newDate: null }, now)).toEqual({ delay_notified_at: "2026-12-17T10:00:00.000Z" });
  });
  it("writes nothing when the date holds", () => {
    expect(orderUpdateFor({ oldDate: "2026-12-20", newDate: "2026-12-20" }, now)).toEqual({});
  });
});

describe("reportLine", () => {
  const plan = { changed: [item("a", "in_stock", "1_2_weeks"), item("b", "in_stock", null)], oldDate: "2026-12-20", newDate: "2026-12-28" };
  const o = { id: "abcdef12-0000", customer_name: "Sara" };
  it("formats the three e-mail outcomes", () => {
    expect(reportLine(o, plan, "sent")).toBe("abcdef12 Sara: part a, part b — 2026-12-20 → 2026-12-28 (emailed)");
    expect(reportLine(o, plan, "failed")).toContain("(EMAIL FAILED)");
    expect(reportLine(o, { ...plan, newDate: null }, "no_address")).toBe(
      "abcdef12 Sara: part a, part b — 2026-12-20 → undated (no email — contact on WhatsApp)",
    );
  });
});
