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
//
// Errors are never swallowed (SITE_AUDIT #3). A failed read keeps the last
// good lines and sets `error` to "load"; a failed write sets it to "save" and
// the mutation resolves false. The mutations never throw (some callers fire
// and forget); `retry()` reads the cart again.

type AddOptions = { bomLines?: string[]; kitId?: string | null };

/** "load": the cart could not be read; "save": a change was not saved. */
export type CartError = "load" | "save";

type CartContextValue = {
  items: CartItem[];
  /** Resolves false when the line was not saved (and `error` is "save"). */
  addItem: (part: Pick<Part, "id" | "min_order_qty">, qty: number, projectId?: string | null, opts?: AddOptions) => Promise<boolean>;
  /** Row-level: a product can sit on several lines (loose, per project, in a kit). */
  updateQty: (rowId: string, qty: number) => Promise<boolean>;
  removeItem: (rowId: string) => Promise<boolean>;
  removeKit: (kitId: string) => Promise<boolean>;
  clearCart: () => Promise<boolean>;
  itemCount: number;
  /** Before any kit discount. */
  subtotalQar: number;
  kitDiscountQar: number;
  /** What checkout will charge: subtotal less the kit discount. */
  totalQar: number;
  kitDiscountPct: number;
  ready: boolean;
  /** The last read or write failure; the lines shown are the last good read. */
  error: CartError | null;
  /** Read the cart again (clears `error` when it succeeds). */
  retry: () => Promise<void>;
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
  const [error, setError] = useState<CartError | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setItems([]);
      setError(null);
      setReady(true);
      return;
    }

    // Kit columns arrive with migration 0025; before it, read the plain cart.
    const full = await supabase
      .from("cart_items")
      .select("id, quantity, project_id, kit_id, bom_lines, part:parts(*), project:projects(name)")
      .order("created_at", { ascending: true });
    const res = full.error
      ? await supabase
          .from("cart_items")
          .select("id, quantity, project_id, part:parts(*)")
          .order("created_at", { ascending: true })
      : full;

    if (res.error) {
      // Keep the last good lines: showing an empty cart here would be wrong.
      console.error("cart: load failed", full.error, res.error);
      setError("load");
      setReady(true);
      return;
    }

    const rows = (res.data ?? []) as unknown as Row[];
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

    const { data: setting, error: settingError } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "kit_discount_pct")
      .maybeSingle();
    if (settingError) {
      // The kit price shown would be wrong; keep the last known discount.
      console.error("cart: kit discount load failed", settingError);
      setError("load");
    } else {
      const pct = Number(setting?.value);
      setKitDiscountPct(Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 90) : 0);
      setError(null);
    }
    setReady(true);
  }, []);

  /** A failed write: re-read so the lines shown match what is saved, then say so. */
  const failed = useCallback(
    async (what: string, e: unknown) => {
      console.error(`cart: ${what} failed`, e);
      await reload();
      setError("save");
      return false;
    },
    [reload]
  );

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
    async (part: Pick<Part, "id" | "min_order_qty">, qty: number, projectId: string | null = null, opts: AddOptions = {}) => {
      const quantity = Math.max(part.min_order_qty, Math.trunc(qty) || part.min_order_qty);
      let user: Awaited<ReturnType<typeof ensureSession>>;
      try {
        user = await ensureSession();
      } catch (e) {
        return failed("add (session)", e);
      }
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
      if (found.error) return failed("add (lookup)", found.error);
      const existing = found.data as { id: string; quantity: number; bom_lines?: string[] } | null;
      const lines = [...new Set([...(existing?.bom_lines ?? []), ...(opts.bomLines ?? [])])];

      const { error: saveError } = existing
        ? await supabase
            .from("cart_items")
            .update({ quantity: existing.quantity + quantity, ...(opts.bomLines?.length ? { bom_lines: lines } : {}) })
            .eq("id", existing.id)
        : await supabase.from("cart_items").insert({
            user_id: user.id,
            product_id: part.id,
            project_id: projectId,
            quantity,
            ...(opts.bomLines?.length ? { bom_lines: lines } : {}),
            ...(kitId ? { kit_id: kitId } : {}),
          });
      if (saveError) return failed("add", saveError);
      await reload();
      return true;
    },
    [reload, failed]
  );

  const updateQty = useCallback(
    async (rowId: string, qty: number) => {
      const line = items.find((i) => i.rowId === rowId);
      if (!line) return false;
      const quantity = Math.max(line.minOrderQty, Math.trunc(qty) || line.minOrderQty);
      const { error: e } = await createClient().from("cart_items").update({ quantity }).eq("id", rowId);
      if (e) return failed("update quantity", e);
      await reload();
      return true;
    },
    [items, reload, failed]
  );

  const removeItem = useCallback(
    async (rowId: string) => {
      const { error: e } = await createClient().from("cart_items").delete().eq("id", rowId);
      if (e) return failed("remove", e);
      await reload();
      return true;
    },
    [reload, failed]
  );

  const removeKit = useCallback(
    async (kitId: string) => {
      const supabase = createClient();
      const lines = await supabase.from("cart_items").delete().eq("kit_id", kitId);
      if (lines.error) return failed("remove kit (lines)", lines.error);
      const kit = await supabase.from("project_kits").delete().eq("id", kitId);
      if (kit.error) return failed("remove kit", kit.error);
      await reload();
      return true;
    },
    [reload, failed]
  );

  const clearCart = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error: e } = await supabase.from("cart_items").delete().eq("user_id", user.id);
      if (e) return failed("clear", e);
    }
    setItems([]);
    return true;
  }, [failed]);

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
      error,
      retry: reload,
      reload,
    };
  }, [items, addItem, updateQty, removeItem, removeKit, clearCart, kitDiscountPct, ready, error, reload]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
