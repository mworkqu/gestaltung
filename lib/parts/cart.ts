// Cart line helpers. The live cart is the `cart_items` table, read and written
// by components/parts/cart-provider.tsx; this module is what that provider
// shares with the rest of the storefront:
//  - toCartItem: build a display line (CartItem) from a part row.
//  - getCart / saveCart: the legacy localStorage cart (CART_KEY). The provider
//    reads it once to migrate old guest carts into cart_items, then clears it.
//  - cartItemCount / cartTotal: totals over a CartItem[].
// (The last server read is cached separately in cart-snapshot.ts.) Items are
// keyed by SKU (unique per part).

import type { CartItem } from "@/lib/supabase/types";
import { CART_KEY } from "@/lib/parts/storage-keys";
import type { LeadTimeClass } from "@/lib/store/sourcing";
import { packSizeOf } from "@/lib/store/pack";

// A minimal shape (a Part row or a cart-stored snapshot) that toCartItem accepts.
// stock_status is admin-only and deliberately not carried into the cart
// (owner decision 4b): the storefront speaks in lead times only.
type PartLike = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  unit_price: number;
  image_url: string | null;
  min_order_qty: number;
  lead_time_class?: LeadTimeClass | null;
  pack_size?: number | null;
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
    leadTimeClass: part.lead_time_class ?? null,
    packSize: packSizeOf(part),
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

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}
