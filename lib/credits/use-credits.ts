"use client";

// Browser side of AI credits: read-only. Balances and "what would this cost"
// come from the 0042 functions; nothing here can change a balance — spending
// happens in the API routes after a successful result.
//
// Both hooks refetch when CREDITS_CHANGED fires on window (call
// creditsChanged() after any AI action) and return null until 0042 has run,
// so callers simply show no credit UI before then.

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { CREDITS_CHANGED, type AiStep, type CanUse, type CreditSummary } from "./constants";

export function creditsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CREDITS_CHANGED));
}

/** No session = nothing to ask (and no request for every visitor). */
async function hasSession() {
  const { data } = await createClient().auth.getSession();
  return !!data.session;
}

function useRefetch(load: () => Promise<void>) {
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(CREDITS_CHANGED, on);
    const { data } = createClient().auth.onAuthStateChange(() => void load());
    return () => {
      window.removeEventListener(CREDITS_CHANGED, on);
      data.subscription.unsubscribe();
    };
  }, [load]);
}

export function useCreditSummary(): CreditSummary | null {
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const load = useCallback(async () => {
    if (!(await hasSession())) return setSummary(null);
    const { data, error } = await createClient().rpc("credit_summary");
    setSummary(error ? null : (data as CreditSummary));
  }, []);
  useRefetch(load);
  return summary;
}

export function useCanUse(step: AiStep, projectId: string | null): CanUse | null {
  const [state, setState] = useState<CanUse | null>(null);
  const load = useCallback(async () => {
    if (!(await hasSession())) return setState(null);
    const { data, error } = await createClient().rpc("credit_can_use", { p_step: step, p_project: projectId });
    setState(error ? null : (data as CanUse));
  }, [step, projectId]);
  useRefetch(load);
  return state;
}
