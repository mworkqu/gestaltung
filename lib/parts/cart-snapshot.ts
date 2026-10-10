// The last cart read from the server, kept in localStorage so the cart page can
// show its lines at once instead of after the lazy Supabase import and two
// queries. It is a display cache only: the lines are marked stale until the
// real read confirms them, checkout stays disabled while stale, and the
// snapshot belongs to one user id (a different or missing user drops it).
// Pure helpers over a Storage-like object, so the rules are unit-tested.

import type { CartItem } from "@/lib/supabase/types";

export const CART_SNAPSHOT_KEY = "gestaltung:cart-snapshot:v1";
/** Older than this is not worth showing, even as a placeholder. */
export const CART_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type CartSnapshot = {
  userId: string;
  items: CartItem[];
  kitDiscountPct: number;
  at: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Shape check: a hand-edited or old-format value is ignored, never trusted. */
export function parseSnapshot(raw: string | null, now: number): CartSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CartSnapshot> | null;
    if (!v || typeof v.userId !== "string" || !v.userId) return null;
    if (!Array.isArray(v.items) || typeof v.at !== "number") return null;
    if (now - v.at > CART_SNAPSHOT_MAX_AGE_MS || v.at > now + 60_000) return null;
    const ok = v.items.every(
      (i) =>
        i &&
        typeof i.rowId === "string" &&
        typeof i.partId === "string" &&
        typeof i.sku === "string" &&
        typeof i.name === "string" &&
        typeof i.unitPrice === "number" &&
        Number.isFinite(i.unitPrice) &&
        typeof i.quantity === "number" &&
        Number.isFinite(i.quantity)
    );
    if (!ok) return null;
    const pct = Number(v.kitDiscountPct);
    return {
      userId: v.userId,
      items: v.items,
      kitDiscountPct: Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 90) : 0,
      at: v.at,
    };
  } catch {
    return null;
  }
}

export function readCartSnapshot(store: StorageLike | null = browserStorage(), now = Date.now()): CartSnapshot | null {
  if (!store) return null;
  try {
    return parseSnapshot(store.getItem(CART_SNAPSHOT_KEY), now);
  } catch {
    return null;
  }
}

export function writeCartSnapshot(
  snap: { userId: string; items: CartItem[]; kitDiscountPct: number },
  store: StorageLike | null = browserStorage(),
  now = Date.now()
): void {
  if (!store) return;
  try {
    // An empty cart needs no placeholder.
    if (snap.items.length === 0) store.removeItem(CART_SNAPSHOT_KEY);
    else store.setItem(CART_SNAPSHOT_KEY, JSON.stringify({ ...snap, at: now }));
  } catch {
    // Quota or privacy mode: the cart just loads the slow way.
  }
}

export function clearCartSnapshot(store: StorageLike | null = browserStorage()): void {
  try {
    store?.removeItem(CART_SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}
