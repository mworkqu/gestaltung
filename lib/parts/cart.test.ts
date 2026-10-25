import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/lib/supabase/types";
import { kitDiscountQar, money } from "@/lib/prototyping/kit-money";
import { CART_KEY } from "@/lib/parts/storage-keys";
import { cartItemCount, cartTotal, getCart, saveCart, toCartItem } from "./cart";

const line = (over: Partial<CartItem> = {}): CartItem => ({
  partId: "p1",
  sku: "SKU-1",
  name: "Resistor",
  nameAr: null,
  unitPrice: 2.5,
  imageUrl: null,
  minOrderQty: 1,
  leadTimeClass: null,
  packSize: 1,
  quantity: 1,
  ...over,
});

describe("cartTotal / cartItemCount", () => {
  it("is 0 for an empty cart", () => {
    expect(cartTotal([])).toBe(0);
    expect(cartItemCount([])).toBe(0);
  });

  it("sums unitPrice x quantity and counts listings, not lines", () => {
    const items = [line({ unitPrice: 2.5, quantity: 4 }), line({ sku: "B", unitPrice: 10, quantity: 2 })];
    expect(cartTotal(items)).toBe(30);
    expect(cartItemCount(items)).toBe(6);
  });

  it("does not round: floating-point drift is the caller's to round (cart-provider uses money())", () => {
    const total = cartTotal([line({ unitPrice: 0.1, quantity: 3 })]);
    expect(total).not.toBe(0.3);
    expect(money(total)).toBe(0.3);
  });
});

describe("kitDiscountQar (the cart's kit discount rounding)", () => {
  it("rounds to the fils", () => {
    expect(kitDiscountQar(33.33, 10)).toBe(3.33);
    expect(kitDiscountQar(100, 5)).toBe(5);
  });

  it("clamps the percentage to 0..90 and treats junk as 0", () => {
    expect(kitDiscountQar(100, -5)).toBe(0);
    expect(kitDiscountQar(100, 150)).toBe(90);
    expect(kitDiscountQar(100, Number.NaN)).toBe(0);
    expect(kitDiscountQar(0, 10)).toBe(0);
  });
});

describe("toCartItem", () => {
  const part = {
    id: "p1",
    sku: "S1",
    name: "M3 Screws - 5 Pcs",
    name_ar: "براغي",
    unit_price: 4,
    image_url: "https://x/y.png",
    min_order_qty: 2,
  };

  it("maps a part row to a display line and omits stock_status", () => {
    const item = toCartItem(part, 3);
    expect(item).toEqual({
      partId: "p1",
      sku: "S1",
      name: "M3 Screws - 5 Pcs",
      nameAr: "براغي",
      unitPrice: 4,
      imageUrl: "https://x/y.png",
      minOrderQty: 2,
      leadTimeClass: null,
      packSize: 5, // read from the name when pack_size is absent
      quantity: 3,
    });
  });

  it("prefers a stored pack_size above 1 and carries the lead-time class", () => {
    const item = toCartItem({ ...part, pack_size: 10, lead_time_class: "3_5_days" }, 1);
    expect(item.packSize).toBe(10);
    expect(item.leadTimeClass).toBe("3_5_days");
  });
});

describe("legacy localStorage cart", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips through CART_KEY", () => {
    const items = [line({ quantity: 2 }), line({ sku: "B", unitPrice: 9 })];
    saveCart(items);
    expect(JSON.parse(store.get(CART_KEY)!)).toEqual(items);
    expect(getCart()).toEqual(items);
  });

  it("returns [] for missing, corrupt or non-array data", () => {
    expect(getCart()).toEqual([]);
    store.set(CART_KEY, "{not json");
    expect(getCart()).toEqual([]);
    store.set(CART_KEY, '{"a":1}');
    expect(getCart()).toEqual([]);
  });

  it("saveCart swallows a quota error", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => saveCart([line()])).not.toThrow();
  });
});

describe("server (no window)", () => {
  it("getCart is [] and saveCart is a no-op", () => {
    expect(getCart()).toEqual([]);
    expect(() => saveCart([line()])).not.toThrow();
  });
});
