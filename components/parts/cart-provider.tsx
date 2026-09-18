"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CartItem, Part } from "@/lib/supabase/types";
import { cartItemCount, cartTotal, getCart, saveCart, toCartItem } from "@/lib/parts/cart";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";

// ── The cart ────────────────────────────────────────────────────────────────
//
// Previously localStorage only: bound to a browser rather than a person, and
// unable to say which project a line belonged to. Now every line is a
// cart_items row owned by a user_id and optionally tagged with a project, so it
// follows the client across devices and survives signing up (the anonymous user
// is upgraded in place, so the rows never move).
//
// Adding an item from inside a project tags the line with that project; buying
// straight from the store leaves project_id null. Either way NO ORDER IS
// PLACED — checkout stays a separate, deliberate step.
//
// A cart left in localStorage by the old build is migrated once, on first load,
// so nobody loses what they had.

type CartContextValue = {
  items: CartItem[];
  addItem: (part: Part, qty: number, projectId?: string | null) => Promise<void>;
  updateQty: (sku: string, qty: number) => Promise<void>;
  removeItem: (sku: string) => Promise<void>;
  clearCart: () => Promise<void>;
  itemCount: number;
  totalQar: number;
  ready: boolean;
  reload: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

type Row = {
  id: string;
  quantity: number;
  project_id: string | null;
  part: Part | null;
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // No session yet means an empty cart. Don't mint a user just to read one.
    if (!user) {
      setItems([]);
      setReady(true);
      return;
    }

    const { data } = await supabase
      .from("cart_items")
      .select("id, quantity, project_id, part:parts(*)")
      .order("created_at", { ascending: true });

    const rows = (data ?? []) as unknown as Row[];
    setItems(
      rows
        .filter((r): r is Row & { part: Part } => Boolean(r.part))
        .map((r) => ({
          ...toCartItem(r.part, r.quantity),
          projectId: r.project_id,
        }))
    );
    setReady(true);
  }, []);

  // One-time migration of a pre-existing localStorage cart.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const legacy = getCart();
      if (legacy.length > 0) {
        try {
          const user = await ensureSession();
          const supabase = createClient();
          const { data: parts } = await supabase
            .from("parts")
            .select("id, sku")
            .in("sku", legacy.map((l) => l.sku));
          const bySku = new Map((parts ?? []).map((p) => [p.sku as string, p.id as string]));

          for (const line of legacy) {
            const productId = bySku.get(line.sku);
            if (!productId) continue;
            await supabase
              .from("cart_items")
              .upsert(
                {
                  user_id: user.id,
                  product_id: productId,
                  project_id: null,
                  quantity: line.quantity,
                },
                { onConflict: "user_id,product_id,project_id" }
              );
          }
          saveCart([]);
        } catch {
          // Leave the legacy cart alone and try again next load.
        }
      }

      if (!cancelled) await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  const addItem = useCallback(
    async (part: Part, qty: number, projectId: string | null = null) => {
      const quantity = Math.max(part.min_order_qty, Math.trunc(qty) || part.min_order_qty);
      const user = await ensureSession();
      const supabase = createClient();

      // `.is(col, null)` and `.eq(col, value)` are different operators in
      // PostgREST — null never matches with eq — so the filter has to branch.
      const base = supabase
        .from("cart_items")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("product_id", part.id);

      const { data: existing } = await (projectId === null
        ? base.is("project_id", null)
        : base.eq("project_id", projectId)
      ).maybeSingle();

      if (existing) {
        await supabase
          .from("cart_items")
          .update({ quantity: existing.quantity + quantity })
          .eq("id", existing.id);
      } else {
        await supabase.from("cart_items").insert({
          user_id: user.id,
          product_id: part.id,
          project_id: projectId,
          quantity,
        });
      }
      await reload();
    },
    [reload]
  );

  const updateQty = useCallback(
    async (sku: string, qty: number) => {
      const line = items.find((i) => i.sku === sku);
      if (!line) return;
      const quantity = Math.max(line.minOrderQty, Math.trunc(qty) || line.minOrderQty);
      const supabase = createClient();
      await supabase
        .from("cart_items")
        .update({ quantity })
        .eq("product_id", line.partId);
      await reload();
    },
    [items, reload]
  );

  const removeItem = useCallback(
    async (sku: string) => {
      const line = items.find((i) => i.sku === sku);
      if (!line) return;
      await createClient().from("cart_items").delete().eq("product_id", line.partId);
      await reload();
    },
    [items, reload]
  );

  const clearCart = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.from("cart_items").delete().eq("user_id", user.id);
    setItems([]);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      addItem,
      updateQty,
      removeItem,
      clearCart,
      itemCount: cartItemCount(items),
      totalQar: cartTotal(items),
      ready,
      reload,
    }),
    [items, addItem, updateQty, removeItem, clearCart, ready, reload]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
