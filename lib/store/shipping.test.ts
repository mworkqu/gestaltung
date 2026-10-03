import { describe, expect, it } from "vitest";

import {
  activeFreeShipping,
  freeDeliveryGap,
  isPlausibleEmail,
  minDeliveryFrom,
  qarAmount,
  shippingFor,
  tierShipsFree,
} from "@/lib/store/shipping";

// The owner's settings after 0044: QAR 50 every tier, handling 0, free
// Standard delivery from a QAR 300 goods subtotal.
const tiers = {
  express: { carrier_cost_qar: 50 },
  standard: { carrier_cost_qar: 50 },
  economy: { carrier_cost_qar: 50 },
};
const fs = { threshold_qar: 300, tiers: ["standard" as const] };
const at = (tier: "express" | "standard" | "economy", goodsQar: number, extra: Partial<Parameters<typeof shippingFor>[0]> = {}) =>
  shippingFor({ tier, goodsQar, tiers, handlingFeeQar: 0, freeShipping: fs, ...extra });

describe("shippingFor", () => {
  it("charges QAR 50 on every tier below the threshold", () => {
    for (const t of ["express", "standard", "economy"] as const) {
      expect(at(t, 120)).toEqual({ shippingQar: 50, handlingQar: 0, free: false });
    }
  });

  it("handling 0 (or missing / negative) is 0", () => {
    expect(at("standard", 10).handlingQar).toBe(0);
    expect(at("standard", 10, { handlingFeeQar: null }).handlingQar).toBe(0);
    expect(at("standard", 10, { handlingFeeQar: -5 }).handlingQar).toBe(0);
    expect(at("standard", 10, { handlingFeeQar: 10 }).handlingQar).toBe(10);
  });

  it("299 is not free; 300 is free on Standard only", () => {
    expect(at("standard", 299)).toMatchObject({ shippingQar: 50, free: false });
    expect(at("standard", 299.99)).toMatchObject({ shippingQar: 50, free: false });
    expect(at("standard", 300)).toMatchObject({ shippingQar: 0, free: true });
    expect(at("standard", 1000)).toMatchObject({ shippingQar: 0, free: true });
  });

  it("Express is never free and Economy stays QAR 50", () => {
    expect(at("express", 300)).toMatchObject({ shippingQar: 50, free: false });
    expect(at("express", 5000)).toMatchObject({ shippingQar: 50, free: false });
    expect(at("economy", 300)).toMatchObject({ shippingQar: 50, free: false });
  });

  it("no free delivery when the threshold is missing, zero or negative", () => {
    expect(at("standard", 500, { freeShipping: null })).toMatchObject({ shippingQar: 50, free: false });
    expect(at("standard", 500, { freeShipping: undefined })).toMatchObject({ shippingQar: 50, free: false });
    expect(at("standard", 500, { freeShipping: { threshold_qar: 0, tiers: ["standard"] } }).free).toBe(false);
    expect(at("standard", 500, { freeShipping: { threshold_qar: -1, tiers: ["standard"] } }).free).toBe(false);
  });

  it("a split order pays the carrier twice, but free stays free", () => {
    expect(at("express", 400, { split: true })).toMatchObject({ shippingQar: 100, free: false });
    expect(at("standard", 200, { split: true })).toMatchObject({ shippingQar: 100, free: false });
    expect(at("standard", 300, { split: true })).toMatchObject({ shippingQar: 0, free: true });
  });

  it("prices from base_cost_qar when the server already zeroed carrier_cost_qar", () => {
    const quoted = { standard: { carrier_cost_qar: 0, base_cost_qar: 50 } };
    expect(shippingFor({ tier: "standard", goodsQar: 100, tiers: quoted, freeShipping: fs }).shippingQar).toBe(50);
    expect(shippingFor({ tier: "standard", goodsQar: 300, tiers: quoted, freeShipping: fs }).shippingQar).toBe(0);
  });

  it("a tier that isn't configured costs nothing and isn't free", () => {
    expect(shippingFor({ tier: "economy", goodsQar: 100, tiers: { standard: { carrier_cost_qar: 50 } } })).toEqual({
      shippingQar: 0,
      handlingQar: 0,
      free: false,
    });
  });
});

describe("tierShipsFree / activeFreeShipping", () => {
  it("follows the configured tier list", () => {
    const both = { threshold_qar: 300, tiers: ["standard" as const, "economy" as const] };
    expect(tierShipsFree("economy", 300, both)).toBe(true);
    expect(tierShipsFree("express", 300, both)).toBe(false);
  });
  it("treats a non-numeric threshold as off", () => {
    expect(activeFreeShipping({ threshold_qar: Number("x"), tiers: ["standard"] })).toBeNull();
  });
});

describe("minDeliveryFrom", () => {
  it("is the cheapest normal price", () => {
    expect(minDeliveryFrom(tiers)).toBe(50);
    expect(minDeliveryFrom({ express: { carrier_cost_qar: 45 }, economy: { carrier_cost_qar: 10 } })).toBe(10);
  });
  it("uses the normal price, not a free one", () => {
    expect(minDeliveryFrom({ standard: { carrier_cost_qar: 0, base_cost_qar: 50 }, express: { carrier_cost_qar: 50 } })).toBe(50);
  });
  it("is null with no tiers", () => {
    expect(minDeliveryFrom(null)).toBeNull();
    expect(minDeliveryFrom({})).toBeNull();
  });
});

describe("freeDeliveryGap", () => {
  it("rounds the missing amount up to whole QAR", () => {
    expect(freeDeliveryGap(299, fs)).toBe(1);
    expect(freeDeliveryGap(299.99, fs)).toBe(1);
    expect(freeDeliveryGap(250.5, fs)).toBe(50);
    expect(freeDeliveryGap(0, fs)).toBe(300);
  });
  it("is 0 at or over the threshold", () => {
    expect(freeDeliveryGap(300, fs)).toBe(0);
    expect(freeDeliveryGap(301, fs)).toBe(0);
  });
  it("is null when there is no free delivery", () => {
    expect(freeDeliveryGap(100, null)).toBeNull();
    expect(freeDeliveryGap(100, { threshold_qar: 0, tiers: ["standard"] })).toBeNull();
  });
});

describe("qarAmount / isPlausibleEmail", () => {
  it("formats whole and fractional amounts", () => {
    expect(qarAmount(50)).toBe("50");
    expect(qarAmount(12.5)).toBe("12.50");
  });
  it("accepts real-looking emails only", () => {
    expect(isPlausibleEmail("a@b.qa")).toBe(true);
    expect(isPlausibleEmail("  name.surname@mail.example.com ")).toBe(true);
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail(null)).toBe(false);
    expect(isPlausibleEmail("no-at-sign.qa")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a b@c.qa")).toBe(false);
  });
});
