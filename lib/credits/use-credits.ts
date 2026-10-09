"use client";

// Browser side of AI credits: read-only. Balances and "what would this cost"
// come from the 0042 functions; nothing here can change a balance — spending
// happens in the API routes after a successful result.
//
// Both hooks refetch when CREDITS_CHANGED fires on window (call
// creditsChanged() after any AI action) and return null until 0042 has run,
// so callers simply show no credit UI before then.
//
// Requests: who is asking comes from the shared <AuthProvider> (no extra auth
// call), nothing is asked of Supabase for a visitor with no session, and every
// component that wants the balance shares ONE credit_summary request (the
// header badge, the project list and checkout used to fire one each).

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { useAuth } from "@/components/auth/auth-provider";
import { createSharedLoader } from "@/lib/dedupe";
import { createClient } from "@/lib/supabase/client";
import { CREDITS_CHANGED, noFreeCircuit, type AiStep, type CanUse, type CreditSummary, type RawCanUse } from "./constants";

export function creditsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CREDITS_CHANGED));
}

// Keyed by user id + account state (a guest upgraded in place keeps its id but
// becomes a different credit role) so nobody sees a stale balance. The
// short TTL covers components that mount a moment apart on one page load;
// creditsChanged() forces a fresh read.
const summaries = createSharedLoader<string, CreditSummary | null>(
  async () => {
    const { data, error } = await createClient().rpc("credit_summary");
    return error ? null : (data as CreditSummary);
  },
  { ttlMs: 10_000 }
);

/** Changes when the person or their account state does (guest -> account, email confirmed). */
function userKey(user: User | null): string | null {
  return user ? `${user.id}:${user.is_anonymous ? "anon" : "user"}:${user.email_confirmed_at ? "c" : "u"}` : null;
}

export function useCreditSummary(): CreditSummary | null {
  const { ready, user } = useAuth();
  const uid = userKey(user);
  const [summary, setSummary] = useState<CreditSummary | null>(null);

  useEffect(() => {
    if (!ready) return;
    // No session at all: nothing to ask (and no request for every visitor).
    if (!uid) {
      setSummary(null);
      return;
    }
    let alive = true;
    const load = (force: boolean) =>
      void summaries.get(uid, { force }).then(
        (s) => alive && setSummary(s),
        () => alive && setSummary(null)
      );
    load(false);
    const on = () => load(true);
    window.addEventListener(CREDITS_CHANGED, on);
    return () => {
      alive = false;
      window.removeEventListener(CREDITS_CHANGED, on);
    };
  }, [ready, uid]);

  return summary;
}

export function useCanUse(step: AiStep, projectId: string | null): CanUse | null {
  const { ready, user } = useAuth();
  const uid = userKey(user);
  const [state, setState] = useState<CanUse | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!uid) {
      setState(null);
      return;
    }
    let alive = true;
    const load = async () => {
      const { data, error } = await createClient().rpc("credit_can_use", { p_step: step, p_project: projectId });
      // noFreeCircuit: before 0052 the DB still calls a first circuit "free".
      if (alive) setState(error ? null : noFreeCircuit(data as RawCanUse));
    };
    void load();
    const on = () => void load();
    window.addEventListener(CREDITS_CHANGED, on);
    return () => {
      alive = false;
      window.removeEventListener(CREDITS_CHANGED, on);
    };
  }, [ready, uid, step, projectId]);

  return state;
}
