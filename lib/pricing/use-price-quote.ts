"use client";

// The invited credit price for the signed-in person, or null (= the listed price).
// Price experiment, display only (P4-02): once per page load, and only when a
// session already exists (useAuth never creates one): my_price_quote(); when
// there is no row and a code was saved in this browser, claim_price_cohort(code)
// and use its answer. No session = no request at all. Every error (including the
// RPCs not existing before migration 0060) = null.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { parseQuote, parseQuoteRows, readStoredCode } from "@/lib/pricing/experiment";

// One lookup per user per page load; every AccessNote on the page shares it.
const cache = new Map<string, Promise<number | null>>();

async function lookup(): Promise<number | null> {
  try {
    const supabase = createClient();
    const mine = await supabase.rpc("my_price_quote");
    if (!mine.error) {
      const quote = parseQuoteRows(mine.data);
      if (quote !== null) return quote;
    } else {
      return null;
    }
    const code = readStoredCode();
    if (!code) return null;
    const claimed = await supabase.rpc("claim_price_cohort", { p_code: code });
    return claimed.error ? null : parseQuote(claimed.data);
  } catch {
    return null;
  }
}

export function loadPriceQuote(userId: string): Promise<number | null> {
  let p = cache.get(userId);
  if (!p) {
    p = lookup();
    cache.set(userId, p);
  }
  return p;
}

/** The invited credit price in QAR, or null for "show the listed price". */
export function usePriceQuote(): number | null {
  const { ready, user } = useAuth();
  const userId = ready ? (user?.id ?? null) : null;
  const [state, setState] = useState<{ userId: string; quote: number | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadPriceQuote(userId).then(
      (quote) => {
        if (alive) setState({ userId, quote });
      },
      () => {
        if (alive) setState({ userId, quote: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [userId]);

  return userId && state && state.userId === userId ? state.quote : null;
}
