import { describe, expect, it } from "vitest";

import {
  buildDiscountReport,
  monthKeys,
  parseDiscountSettings,
  qatarMonthKey,
  waivedShippingQar,
  windowStartIso,
  type DiscountSettings,
} from "./discount-report";

const settings: DiscountSettings = {
  creditQar: 20,
  freeShipping: { thresholdQar: 300, tiers: ["standard"] },
  tierFeeQar: { express: 50, standard: 50, economy: 50 },
};

// 2026-10-09 is a Friday, mid-month in Qatar.
const NOW = new Date("2026-10-09T10:00:00Z");

describe("Qatar month buckets", () => {
  it("uses UTC+3: 21:30 UTC on the 30th is already the 1st in Qatar", () => {
    expect(qatarMonthKey("2026-09-30T21:30:00Z")).toBe("2026-10");
    expect(qatarMonthKey("2026-09-30T20:59:59Z")).toBe("2026-09");
  });
  it("returns null for junk", () => {
    expect(qatarMonthKey(null)).toBeNull();
    expect(qatarMonthKey("nope")).toBeNull();
    expect(qatarMonthKey(new Date("x"))).toBeNull();
  });
  it("lists six months newest first across a year boundary", () => {
    expect(monthKeys(new Date("2026-02-10T00:00:00Z")).map((m) => m.key)).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
      "2025-10",
      "2025-09",
    ]);
  });
  it("window starts at 00:00 Qatar on the 1st of the oldest month", () => {
    expect(windowStartIso(NOW)).toBe("2026-04-30T21:00:00.000Z");
  });
  it("the current month is marked, an invalid now gives no months", () => {
    expect(buildDiscountReport({ orders: [], grants: [], settings, now: NOW }).months[0].current).toBe(true);
    expect(monthKeys(new Date("x"))).toEqual([]);
  });
});

describe("buildDiscountReport", () => {
  it("handles empty data: six zero rows, share null", () => {
    const r = buildDiscountReport({ orders: [], grants: [], settings, now: NOW });
    expect(r.months).toHaveLength(6);
    expect(r.months.every((m) => m.totalQar === 0 && m.sharePct === null)).toBe(true);
    expect(r.totals.totalQar).toBe(0);
    expect(r.totals.sharePct).toBeNull();
  });

  it("sums the four leaks per month and the share of goods revenue", () => {
    const r = buildDiscountReport({
      now: NOW,
      settings,
      orders: [
        // goods = 380 - 0 - 0 + 20 = 400 >= 300, standard, shipping waived -> 50
        {
          created_at: "2026-10-02T09:00:00Z",
          status: "paid",
          discount_qar: 30,
          credit_discount_qar: 20,
          shipping_qar: 0,
          handling_fee_qar: 0,
          total_qar: 380,
          shipping_tier: "standard",
        },
        // paid for shipping: nothing waived
        {
          created_at: "2026-10-05T09:00:00Z",
          status: "delivered",
          discount_qar: 0,
          credit_discount_qar: 0,
          shipping_qar: 50,
          total_qar: 250,
          shipping_tier: "standard",
        },
      ],
      grants: [
        { created_at: "2026-10-03T00:00:00Z", delta: 3, reason: "admin_grant" },
        { created_at: "2026-10-04T00:00:00Z", delta: 1, reason: "admin_grant" },
      ],
    });
    const oct = r.months[0];
    expect(oct.key).toBe("2026-10");
    expect(oct.kitQar).toBe(30);
    expect(oct.creditRedeemedQar).toBe(20);
    expect(oct.grantedCredits).toBe(4);
    expect(oct.grantQar).toBe(80);
    expect(oct.freeDeliveryQar).toBe(50);
    expect(oct.totalQar).toBe(180);
    // goods paid: 380 + (250 - 50)
    expect(oct.goodsRevenueQar).toBe(580);
    expect(oct.sharePct).toBe(31.03);
    expect(r.totals.totalQar).toBe(180);
    expect(r.totals.sharePct).toBe(31.03);
    expect(r.creditQar).toBe(20);
  });

  it("skips cancelled and test orders", () => {
    const base = { created_at: "2026-10-02T09:00:00Z", discount_qar: 99, total_qar: 500 };
    const r = buildDiscountReport({
      now: NOW,
      settings,
      grants: [],
      orders: [{ ...base, status: "cancelled" }, { ...base, status: "paid", is_test: true }],
    });
    expect(r.totals.kitQar).toBe(0);
    expect(r.totals.goodsRevenueQar).toBe(0);
  });

  it("counts only positive admin_grant ledger rows, valued by the credit value", () => {
    const r = buildDiscountReport({
      now: NOW,
      settings: { ...settings, creditQar: 25 },
      orders: [],
      grants: [
        { created_at: "2026-09-10T00:00:00Z", delta: 2, reason: "admin_grant" },
        { created_at: "2026-09-10T00:00:00Z", delta: -2, reason: "admin_grant" }, // correction
        { created_at: "2026-09-10T00:00:00Z", delta: 5, reason: "purchase:abc" },
        { created_at: "2026-09-10T00:00:00Z", delta: 0, reason: "admin_grant" },
        { created_at: "2026-09-10T00:00:00Z", delta: null, reason: "admin_grant" },
      ],
    });
    const sep = r.months.find((m) => m.key === "2026-09")!;
    expect(sep.grantedCredits).toBe(2);
    expect(sep.grantQar).toBe(50);
  });

  it("ignores rows outside the six months and rows with a bad date", () => {
    const r = buildDiscountReport({
      now: NOW,
      settings,
      grants: [{ created_at: "2025-01-01T00:00:00Z", delta: 9, reason: "admin_grant" }],
      orders: [
        { created_at: "2025-01-01T00:00:00Z", discount_qar: 50, total_qar: 100 },
        { created_at: null, discount_qar: 50, total_qar: 100 },
      ],
    });
    expect(r.totals.totalQar).toBe(0);
  });

  it("treats NULL, string and negative values safely", () => {
    const r = buildDiscountReport({
      now: NOW,
      settings,
      grants: [],
      orders: [
        {
          created_at: "2026-10-02T09:00:00Z",
          discount_qar: "12.50",
          credit_discount_qar: null,
          shipping_qar: null,
          total_qar: "100",
        },
        { created_at: "2026-10-02T09:00:00Z", discount_qar: -5, credit_discount_qar: -1, total_qar: -40 },
      ],
    });
    expect(r.months[0].kitQar).toBe(12.5);
    expect(r.months[0].creditRedeemedQar).toBe(0);
    expect(r.months[0].goodsRevenueQar).toBe(100);
  });

  it("share is null (not Infinity) when a month has discounts but no revenue", () => {
    const r = buildDiscountReport({
      now: NOW,
      settings,
      orders: [],
      grants: [{ created_at: "2026-10-02T00:00:00Z", delta: 1, reason: "admin_grant" }],
    });
    expect(r.months[0].totalQar).toBe(20);
    expect(r.months[0].sharePct).toBeNull();
    expect(r.totals.sharePct).toBeNull();
  });
});

describe("waivedShippingQar", () => {
  const order = {
    created_at: "2026-10-02T09:00:00Z",
    shipping_qar: 0,
    handling_fee_qar: 0,
    total_qar: 300,
    shipping_tier: "standard",
  };
  it("waives the tier fee at exactly the threshold", () => {
    expect(waivedShippingQar(order, settings)).toBe(50);
  });
  it("nothing below the threshold, on another tier, with shipping paid, or with no rule", () => {
    expect(waivedShippingQar({ ...order, total_qar: 299.99 }, settings)).toBe(0);
    expect(waivedShippingQar({ ...order, shipping_tier: "express" }, settings)).toBe(0);
    expect(waivedShippingQar({ ...order, shipping_qar: 50 }, settings)).toBe(0);
    expect(waivedShippingQar({ ...order, shipping_tier: null }, settings)).toBe(0);
    expect(waivedShippingQar(order, { ...settings, freeShipping: null })).toBe(0);
  });
  it("a credit redemption does not push the order under the threshold", () => {
    expect(waivedShippingQar({ ...order, total_qar: 290, credit_discount_qar: 20 }, settings)).toBe(50);
  });
  it("a split order waives two shipments; an unknown tier fee waives 0", () => {
    expect(waivedShippingQar({ ...order, split_shipments: true }, settings)).toBe(100);
    expect(waivedShippingQar(order, { ...settings, tierFeeQar: {} })).toBe(0);
  });
});

describe("parseDiscountSettings", () => {
  it("reads the credit value, free-delivery rule and tier fees", () => {
    const s = parseDiscountSettings({
      pricingPlans: {
        currency: "QAR",
        overage_per_credit_qar: 30,
        refund_window_days: 30,
        plans: [{ id: "institutions", contact: true }],
      },
      freeShipping: { threshold_qar: 300, tiers: ["standard"] },
      shipping: { tiers: { standard: { carrier_cost_qar: 50 }, express: { carrier_cost_qar: "bad" } } },
    });
    expect(s.creditQar).toBe(30);
    expect(s.freeShipping).toEqual({ thresholdQar: 300, tiers: ["standard"] });
    expect(s.tierFeeQar).toEqual({ standard: 50 });
  });
  it("falls back to the code default credit value and no free-delivery rule", () => {
    const s = parseDiscountSettings({ pricingPlans: null, freeShipping: '{"threshold_qar":0,"tiers":["standard"]}', shipping: undefined });
    expect(s.creditQar).toBe(20);
    expect(s.freeShipping).toBeNull();
    expect(s.tierFeeQar).toEqual({});
  });
  it("accepts a JSON string", () => {
    const s = parseDiscountSettings({ freeShipping: '{"threshold_qar":150,"tiers":["standard","economy"]}' });
    expect(s.freeShipping).toEqual({ thresholdQar: 150, tiers: ["standard", "economy"] });
  });
});
