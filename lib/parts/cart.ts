// Guest cart helpers. State lives entirely in localStorage (no auth, no DB
// table). All functions are pure transforms over a CartItem[] except the
// read/save pair that touch storage. Items are keyed by SKU (unique per part).

import type { CartItem, Part, StockStatus } from "@/lib/supabase/types";
import { CART_KEY } from "@/lib/parts/constants";

// A minimal shape (Part or a cart-stored snapshot) that addToCart accepts.
type PartLike = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  unit_price: number;
  image_url: string | null;
  min_order_qty: number;
  stock_status: StockStatus;
};

export function toCartItem(part: PartLike, quantity: number): CartItem {
  return {
    partId: part.id,
    sku: part.sku,
    name: part.name,
    nameAr: part.name_ar,
    unitPrice: part.unit_price,
    imageUrl: part.image_url,
    minOrderQty: part.min_order_qty,
    stockStatus: part.stock_status,
    quantity,
  };
}

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // Quota or privacy mode — fail silently; the cart just won't persist.
  }
}

// Add `qty` of a part. If it's already in the cart, increase the quantity.
export function addToCart(
  items: CartItem[],
  part: Part,
  qty: number
): CartItem[] {
  const quantity = Math.max(part.min_order_qty, Math.trunc(qty) || part.min_order_qty);
  const existing = items.find((i) => i.sku === part.sku);
  if (existing) {
    return items.map((i) =>
      i.sku === part.sku ? { ...i, quantity: i.quantity + quantity } : i
    );
  }
  return [...items, toCartItem(part, quantity)];
}

// Set an absolute quantity, clamped to the item's minimum order quantity.
export function updateCartQty(
  items: CartItem[],
  sku: string,
  qty: number
): CartItem[] {
  return items.map((i) =>
    i.sku === sku
      ? { ...i, quantity: Math.max(i.minOrderQty, Math.trunc(qty) || i.minOrderQty) }
      : i
  );
}

export function removeFromCart(items: CartItem[], sku: string): CartItem[] {
  return items.filter((i) => i.sku !== sku);
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}
