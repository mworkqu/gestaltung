import { describe, expect, it } from "vitest";

import type { CartItem } from "@/lib/supabase/types";
import {
  CART_SNAPSHOT_KEY,
  CART_SNAPSHOT_MAX_AGE_MS,
  clearCartSnapshot,
  parseSnapshot,
  readCartSnapshot,
  writeCartSnapshot,
} from "./cart-snapshot";

const item = (over: Partial<CartItem> = {}): CartItem => ({
  rowId: "r1",
  partId: "p1",
  sku: "M4-10",
  name: "Screw",
  nameAr: null,
  unitPrice: 2.5,
  imageUrl: null,
  minOrderQty: 1,
  quantity: 3,
  ...over,
});

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("cart snapshot", () => {
  it("round-trips a cart", () => {
    const s = memory();
    writeCartSnapshot({ userId: "u1", items: [item()], kitDiscountPct: 10 }, s, 1000);
    const snap = readCartSnapshot(s, 2000);
    expect(snap?.userId).toBe("u1");
    expect(snap?.items).toHaveLength(1);
    expect(snap?.kitDiscountPct).toBe(10);
  });

  it("an empty cart removes the snapshot", () => {
    const s = memory();
    writeCartSnapshot({ userId: "u1", items: [item()], kitDiscountPct: 0 }, s, 1000);
    writeCartSnapshot({ userId: "u1", items: [], kitDiscountPct: 0 }, s, 1001);
    expect(s.getItem(CART_SNAPSHOT_KEY)).toBeNull();
  });

  it("ignores junk, old and malformed values", () => {
    expect(parseSnapshot(null, 1)).toBeNull();
    expect(parseSnapshot("not json", 1)).toBeNull();
    expect(parseSnapshot(JSON.stringify({ userId: "u", items: "x", at: 1 }), 2)).toBeNull();
    expect(parseSnapshot(JSON.stringify({ userId: "u", items: [{ sku: 1 }], at: 1, kitDiscountPct: 0 }), 2)).toBeNull();
    const old = JSON.stringify({ userId: "u", items: [item()], at: 0, kitDiscountPct: 0 });
    expect(parseSnapshot(old, CART_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("clamps the discount and clears", () => {
    const raw = JSON.stringify({ userId: "u", items: [item()], at: 5, kitDiscountPct: 500 });
    expect(parseSnapshot(raw, 6)?.kitDiscountPct).toBe(90);
    const s = memory();
    writeCartSnapshot({ userId: "u", items: [item()], kitDiscountPct: 0 }, s);
    clearCartSnapshot(s);
    expect(readCartSnapshot(s)).toBeNull();
  });
});
