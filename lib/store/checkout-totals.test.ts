import { describe, expect, it } from "vitest";

import {
  checkoutTotals,
  creditDiscountQar,
  grandTotalQar,
  isZeroTotal,
  placedTotalQar,
  splitExtraQar,
  tierPrice,
  type CheckoutQuote,
} from "@/lib/store/checkout-totals";
import { cartTotal } from "@/lib/parts/cart";
import { kitDiscountQar } from "@/lib/prototyping/kit-money";
import { round2 } from "@/lib/format/money";
import type { CartItem } from "@/lib/supabase/types";

// The owner's settings after 0044: QAR 50 every tier, handling 0, free
// Standard delivery from a QAR 300 goods subtotal.
const tier = (cost: number) => ({ carrier_cost_qar: cost, base_cost_qar: cost, transit_days: 2, date: null, early_date: null });
const quote = (goodsQar: number, extra: Partial<CheckoutQuote> = {}): CheckoutQuote => ({
  tiers: { express: tier(50), standard: tier(50), economy: tier(50) },
  handling_fee_qar: 0,
  can_split: false,
  free_shipping: { threshold_qar: 300, tiers: ["standard"], goods_qar: goodsQar },
  ...extra,
});

const line = (partId: string, unitPrice: number, quantity: number, kitId: string | null = null): CartItem => ({
  partId,
  sku: partId,
  name: partId,
  nameAr: null,
  unitPrice,
  imageUrl: null,
  minOrderQty: 1,
  quantity,
  kitId,
});

// Same sum as components/parts/cart-provider.tsx (totalQar).
const cartTotalQar = (items: CartItem[], kitPct = 0) =>
  round2(cartTotal(items) - kitDiscountQar(cartTotal(items.filter((i) => i.kitId)), kitPct));

describe("checkoutTotals", () => {
  it("plain cart: goods + QAR 50 Standard", () => {
    const items = [line("a", 12.5, 4), line("b", 35, 2)];
    const total = cartTotalQar(items);
    expect(total).toBe(120);
    const t = checkoutTotals({ quote: quote(total), cartTotalQar: total, tier: "standard", split: false, credits: null });
    expect(t).toMatchObject({ shippingQar: 50, handlingQar: 0, free: false, creditQar: 0, grandTotal: 170, doSplit: false });
  });

  it("kit discount comes off the goods before delivery", () => {
    const items = [line("a", 50, 2, "kit-1"), line("b", 20, 1)];
    const total = cartTotalQar(items, 10);
    expect(total).toBe(110);
    const t = checkoutTotals({ quote: quote(total), cartTotalQar: total, tier: "economy", split: false, credits: null });
    expect(t.grandTotal).toBe(160);
  });

  it("credit redemption is capped at the goods subtotal", () => {
    const t = checkoutTotals({
      quote: quote(120),
      cartTotalQar: 120,
      tier: "standard",
      split: false,
      credits: { redeemable_qar: 17.35 },
    });
    expect(t.creditQar).toBe(17.35);
    expect(t.grandTotal).toBe(152.65);
    expect(creditDiscountQar({ redeemable_qar: 500 }, 120)).toBe(120);
    expect(creditDiscountQar({ redeemable_qar: 5 }, -3)).toBe(0);
    expect(creditDiscountQar(null, 120)).toBe(0);
  });

  it("Standard ships free from QAR 300 goods (the server's goods_qar decides)", () => {
    expect(checkoutTotals({ quote: quote(299.99), cartTotalQar: 299.99, tier: "standard", split: false, credits: null }))
      .toMatchObject({ shippingQar: 50, free: false, grandTotal: 349.99 });
    expect(checkoutTotals({ quote: quote(300), cartTotalQar: 300, tier: "standard", split: false, credits: null }))
      .toMatchObject({ shippingQar: 0, free: true, grandTotal: 300 });
    // The quote's goods subtotal wins over the cart's.
    expect(checkoutTotals({ quote: quote(300), cartTotalQar: 290, tier: "standard", split: false, credits: null }))
      .toMatchObject({ goodsQar: 300, free: true, grandTotal: 290 });
  });

  it("Express is never free", () => {
    const t = checkoutTotals({ quote: quote(900), cartTotalQar: 900, tier: "express", split: false, credits: null });
    expect(t).toMatchObject({ shippingQar: 50, free: false, grandTotal: 950 });
    expect(t.priceOf("standard")).toEqual({ shippingQar: 0, handlingQar: 0, free: true });
  });

  it("split doubles a paid tier only when the quote allows it", () => {
    const q = quote(120, { can_split: true, handling_fee_qar: 5 });
    expect(checkoutTotals({ quote: q, cartTotalQar: 120, tier: "express", split: true, credits: null }))
      .toMatchObject({ doSplit: true, shippingQar: 100, handlingQar: 5, splitExtraQar: 50, grandTotal: 225 });
    expect(checkoutTotals({ quote: quote(120), cartTotalQar: 120, tier: "express", split: true, credits: null }))
      .toMatchObject({ doSplit: false, shippingQar: 50, grandTotal: 170 });
    expect(splitExtraQar(quote(300), "standard", 300)).toBe(0);
  });

  it("without a quote delivery is 0 and the cart total stands", () => {
    const t = checkoutTotals({ quote: null, cartTotalQar: 80, tier: "standard", split: true, credits: null });
    expect(t).toMatchObject({ shippingQar: 0, handlingQar: 0, free: false, splitExtraQar: 0, grandTotal: 80, canSplit: false });
    expect(tierPrice(null, "express", 80, false)).toEqual({ shippingQar: 0, handlingQar: 0, free: false });
  });

  it("zero total is refused", () => {
    const t = checkoutTotals({ quote: quote(300), cartTotalQar: 300, tier: "standard", split: false, credits: { redeemable_qar: 300 } });
    expect(t.grandTotal).toBe(0);
    expect(isZeroTotal(t.grandTotal)).toBe(true);
    expect(isZeroTotal(-0.01)).toBe(true);
    expect(isZeroTotal(0.01)).toBe(false);
  });
});

describe("grandTotalQar / placedTotalQar", () => {
  it("rounds to the fils", () => {
    expect(grandTotalQar({ cartTotalQar: 0.1, creditQar: 0, shippingQar: 0.2, handlingQar: 0 })).toBe(0.3);
  });
  it("swaps the shown credit for what redeem_credits applied", () => {
    expect(placedTotalQar(152.65, 17.35, 17.35)).toBe(152.65);
    expect(placedTotalQar(152.65, 17.35, 0)).toBe(170);
    expect(placedTotalQar(152.65, 17.35, 10)).toBe(160);
  });
});
