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
import { trackDemand } from "@/lib/store/demand-client";

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
// Lines bought for a bill of materials remember which BOM lines they fulfil
// (bom_lines), and a whole BOM bought as a project kit shares one kit_id: the
// cart shows the kit as one entry at one kit price (migration 0025). The kit
// discount shown here is for display; checkout prices it again on the server.
//
// A cart left in localStorage by the old build is migrated once, on first load,
// so nobody loses what they had.

type AddOptions = { bomLines?: string[]; kitId?: string | null };

type CartContextValue = {
  items: CartItem[];
  addItem: (part: Part, qty: number, projectId?: string | null, opts?: AddOptions) => Promise<void>;
  /** Row-level: a product can sit on several lines (loose, per project, in a kit). */
  updateQty: (rowId: string, qty: number) => Promise<void>;
  removeItem: (rowId: string) => Promise<void>;
  removeKit: (kitId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  itemCount: number;
  /** Before any kit discount. */
  subtotalQar: number;
  kitDiscountQar: number;
  /** What checkout will charge: subtotal less the kit discount. */
  totalQar: number;
  kitDiscountPct: number;
  ready: boolean;
  reload: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

type Row = {
  id: string;
  quantity: number;
  project_id: string | null;
  kit_id?: string | null;
  bom_lines?: string[] | null;
  part: Part | null;
  project?: { name: string } | null;
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [kitDiscountPct, setKitDiscountPct] = useState(0);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setItems([]);
      setReady(true);
      return;
    }

    // Kit columns arrive with migration 0025; before it, read the plain cart.
    const full = await supabase
      .from("cart_items")
      .select("id, quantity, project_id, kit_id, bom_lines, part:parts(*), project:projects(name)")
      .order("created_at", { ascending: true });
    const data = full.error
      ? (
          await supabase
            .from("cart_items")
            .select("id, quantity, project_id, part:parts(*)")
            .order("created_at", { ascending: true })
        ).data
      : full.data;

    const rows = (data ?? []) as unknown as Row[];
    setItems(
      rows
        .filter((r): r is Row & { part: Part } => Boolean(r.part))
        .map((r) => ({
          ...toCartItem(r.part, r.quantity),
          rowId: r.id,
          projectId: r.project_id,
          projectName: r.project?.name ?? null,
          kitId: r.kit_id ?? null,
          bomLines: r.bom_lines ?? [],
        }))
    );

    const { data: setting } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "kit_discount_pct")
      .maybeSingle();
    const pct = Number(setting?.value);
    setKitDiscountPct(Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 90) : 0);
    setReady(true);
  }, []);

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
            const { data: existing } = await supabase
              .from("cart_items")
              .select("id")
              .eq("user_id", user.id)
              .eq("product_id", productId)
              .is("project_id", null)
              .limit(1)
              .maybeSingle();
            if (!existing)
              await supabase.from("cart_items").insert({
                user_id: user.id,
                product_id: productId,
                project_id: null,
                quantity: line.quantity,
              });
          }
          saveCart([]);
        } catch {
          // A failed migration leaves the local cart in place for next time.
        }
      }

      if (!cancelled) await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  const addItem = useCallback(
    async (part: Part, qty: number, projectId: string | null = null, opts: AddOptions = {}) => {
      const quantity = Math.max(part.min_order_qty, Math.trunc(qty) || part.min_order_qty);
      const user = await ensureSession();
      trackDemand("add_to_cart", { partId: part.id });
      const supabase = createClient();
      const kitId = opts.kitId ?? null;

      // `.is(col, null)` and `.eq(col, value)` are different operators in
      // PostgREST — null never matches with eq — so the filters branch.
      let q = supabase
        .from("cart_items")
        .select("id, quantity, bom_lines")
        .eq("user_id", user.id)
        .eq("product_id", part.id);
      q = projectId === null ? q.is("project_id", null) : q.eq("project_id", projectId);
      q = kitId === null ? q.is("kit_id", null) : q.eq("kit_id", kitId);
      let found = await q.limit(1).maybeSingle();
      if (found.error) {
        // Before 0025 there is no kit_id / bom_lines: fall back to the plain line.
        let p = supabase.from("cart_items").select("id, quantity").eq("user_id", user.id).eq("product_id", part.id);
        p = projectId === null ? p.is("project_id", null) : p.eq("project_id", projectId);
        found = (await p.limit(1).maybeSingle()) as typeof found;
      }
      const existing = found.data as { id: string; quantity: number; bom_lines?: string[] } | null;
      const lines = [...new Set([...(existing?.bom_lines ?? []), ...(opts.bomLines ?? [])])];

      if (existing) {
        await supabase
          .from("cart_items")
          .update({ quantity: existing.quantity + quantity, ...(opts.bomLines?.length ? { bom_lines: lines } : {}) })
          .eq("id", existing.id);
      } else {
        await supabase.from("cart_items").insert({
          user_id: user.id,
          product_id: part.id,
          project_id: projectId,
          quantity,
          ...(opts.bomLines?.length ? { bom_lines: lines } : {}),
          ...(kitId ? { kit_id: kitId } : {}),
        });
      }
      await reload();
    },
    [reload]
  );

  const updateQty = useCallback(
    async (rowId: string, qty: number) => {
      const line = items.find((i) => i.rowId === rowId);
      if (!line) return;
      const quantity = Math.max(line.minOrderQty, Math.trunc(qty) || line.minOrderQty);
      await createClient().from("cart_items").update({ quantity }).eq("id", rowId);
      await reload();
    },
    [items, reload]
  );

  const removeItem = useCallback(
    async (rowId: string) => {
      await createClient().from("cart_items").delete().eq("id", rowId);
      await reload();
    },
    [reload]
  );

  const removeKit = useCallback(
    async (kitId: string) => {
      const supabase = createClient();
      await supabase.from("cart_items").delete().eq("kit_id", kitId);
      await supabase.from("project_kits").delete().eq("id", kitId);
      await reload();
    },
    [reload]
  );

  const clearCart = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.from("cart_items").delete().eq("user_id", user.id);
    setItems([]);
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const subtotal = cartTotal(items);
    const kitSum = cartTotal(items.filter((i) => i.kitId));
    const discount = Math.round(((kitSum * kitDiscountPct) / 100) * 100) / 100;
    return {
      items,
      addItem,
      updateQty,
      removeItem,
      removeKit,
      clearCart,
      itemCount: cartItemCount(items),
      subtotalQar: subtotal,
      kitDiscountQar: discount,
      totalQar: Math.round((subtotal - discount) * 100) / 100,
      kitDiscountPct,
      ready,
      reload,
    };
  }, [items, addItem, updateQty, removeItem, removeKit, clearCart, kitDiscountPct, ready, reload]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
