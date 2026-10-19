import { describe, expect, it } from "vitest";

import type { DeliveryQuote } from "@/lib/store/delivery";
import { DEFAULT_SCHOOL_PRICING } from "./pricing";
import { CLASS_ORDER_TIER, applyClassDelivery, classDeliveryQar, freeByClassRule } from "./delivery";

const quote = (): DeliveryQuote => ({
  tiers: {
    express: { carrier_cost_qar: 30, base_cost_qar: 30, transit_days: 1, date: "2026-11-02", early_date: null },
    standard: { carrier_cost_qar: 30, base_cost_qar: 30, transit_days: 3, date: "2026-11-05", early_date: null },
    economy: { carrier_cost_qar: 30, base_cost_qar: 30, transit_days: 7, date: "2026-11-10", early_date: null },
  },
  handling_fee_qar: 0,
  held_by: null,
  can_split: false,
  on_request: [],
});

describe("class order delivery", () => {
  it("makes Economy free on a class order and leaves the other tiers alone", () => {
    const out = applyClassDelivery(quote(), DEFAULT_SCHOOL_PRICING, true);
    expect(out.tiers.economy).toMatchObject({ carrier_cost_qar: 0, base_cost_qar: 0, free: true });
    expect(out.tiers.economy?.date).toBe("2026-11-10");
    expect(out.tiers.economy?.transit_days).toBe(7);
    expect(out.tiers.standard?.carrier_cost_qar).toBe(30);
    expect(out.tiers.express?.carrier_cost_qar).toBe(30);
    expect(CLASS_ORDER_TIER).toBe("economy");
  });

  it("leaves a normal order exactly as it was", () => {
    const q = quote();
    expect(applyClassDelivery(q, DEFAULT_SCHOOL_PRICING, false)).toBe(q);
    expect(classDeliveryQar(q, DEFAULT_SCHOOL_PRICING)).toBe(0);
    expect(q.tiers.economy?.carrier_cost_qar).toBe(30);
  });

  it("charges the normal price when the owner turns the rule off", () => {
    const pricing = { ...DEFAULT_SCHOOL_PRICING, free_delivery_class_order: false };
    const out = applyClassDelivery(quote(), pricing, true);
    expect(out.tiers.economy?.carrier_cost_qar).toBe(30);
    expect(classDeliveryQar(quote(), pricing)).toBe(30);
    expect(freeByClassRule(quote(), pricing)).toBe(false);
  });

  it("copes with a quote that has no Economy tier", () => {
    const q: DeliveryQuote = { ...quote(), tiers: { standard: quote().tiers.standard } };
    expect(applyClassDelivery(q, DEFAULT_SCHOOL_PRICING, true)).toBe(q);
    expect(classDeliveryQar(q, DEFAULT_SCHOOL_PRICING)).toBe(0);
    expect(freeByClassRule(q, DEFAULT_SCHOOL_PRICING)).toBe(false);
  });

  it("says nothing was waived when Economy was already free", () => {
    const q = quote();
    q.tiers.economy = { ...q.tiers.economy!, carrier_cost_qar: 0, base_cost_qar: 0, free: true };
    expect(freeByClassRule(q, DEFAULT_SCHOOL_PRICING)).toBe(false);
  });

  it("does not change the object it was given", () => {
    const q = quote();
    applyClassDelivery(q, DEFAULT_SCHOOL_PRICING, true);
    expect(q.tiers.economy?.carrier_cost_qar).toBe(30);
  });
});
