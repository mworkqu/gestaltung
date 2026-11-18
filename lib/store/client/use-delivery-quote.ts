"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { DeliveryQuote } from "@/lib/store/delivery";

/**
 * The server's delivery quote for these cart lines (public.order_delivery_quote).
 * `legacy` is true when the database predates migration 0029 (the function
 * doesn't exist) — checkout then keeps the old flow instead of blocking.
 * `error` is true when the quote failed for any other reason, so the page can
 * say so instead of silently showing no delivery options.
 * kit_id is sent so the server's goods subtotal (free delivery, 0044) applies
 * the kit discount exactly as the order will; older databases ignore it.
 *
 * 3e: with `classId` (a teacher buying the parts for every team in their class)
 * the quote comes from public.class_order_delivery_quote instead, which is the
 * same quote with Economy at QAR 0 — the rule lives in the database, so the
 * page only displays it. Only the class's own teacher may call it; anything
 * else, or a database without migration 0097, falls back to the normal quote.
 */
export function useDeliveryQuote(
  items: { partId: string; quantity: number; kitId?: string | null }[],
  classId?: string | null,
) {
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState(false);
  const key = items.map((i) => `${i.partId}:${i.quantity}:${i.kitId ?? ""}`).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setQuote(null);
      return;
    }
    const p_items = key.split(",").map((s) => {
      const [part_id, quantity, kit_id] = s.split(":");
      return { part_id, quantity: Number(quantity), kit_id: kit_id || null };
    });
    const client = createClient();
    const normal = () => client.rpc("order_delivery_quote", { p_items });
    const first = classId
      ? client.rpc("class_order_delivery_quote", { p_items, p_class: classId })
      : normal();
    first
      .then((r) => (classId && r.error ? normal() : r))
      .then(({ data, error }) => {
        if (cancelled) return;
        setLegacy(error?.code === "PGRST202");
        setError(Boolean(error) && error?.code !== "PGRST202");
        setQuote((data ?? null) as DeliveryQuote | null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, classId]);

  return { quote, legacy, error };
}
