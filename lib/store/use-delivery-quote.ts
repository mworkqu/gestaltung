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
 */
export function useDeliveryQuote(items: { partId: string; quantity: number }[]) {
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState(false);
  const key = items.map((i) => `${i.partId}:${i.quantity}`).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setQuote(null);
      return;
    }
    const p_items = key.split(",").map((s) => {
      const [part_id, quantity] = s.split(":");
      return { part_id, quantity: Number(quantity) };
    });
    createClient()
      .rpc("order_delivery_quote", { p_items })
      .then(({ data, error }) => {
        if (cancelled) return;
        setLegacy(error?.code === "PGRST202");
        setError(Boolean(error) && error?.code !== "PGRST202");
        setQuote((data ?? null) as DeliveryQuote | null);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { quote, legacy, error };
}
