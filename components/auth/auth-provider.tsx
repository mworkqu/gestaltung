"use client";

// ONE place that reads who the visitor is. The header, the credit badge and the
// cart used to each call auth.getUser() (a network request) on every page; now
// they share this provider, which reads the session the browser already holds
// (no request at all for a visitor without a session) and listens to a single
// auth-state subscription.
//
// `user` is the Supabase user, or null for a visitor with no session. A guest
// is a user with is_anonymous === true (see lib/auth/guest-redirect.ts).

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { getCurrentUser } from "@/lib/supabase/guest";
import { loadSupabase } from "@/lib/supabase/lazy";

export type AuthState = {
  /** False until the first read finished; `user` is null until then. */
  ready: boolean;
  user: User | null;
};

const AuthContext = createContext<AuthState | null>(null);

/** Token refreshes hand back a new object for the same person: don't re-render. */
function sameUser(a: User | null, b: User | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.is_anonymous === b.is_anonymous &&
    a.email === b.email &&
    !!a.email_confirmed_at === !!b.email_confirmed_at
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, user: null });

  useEffect(() => {
    let alive = true;
    const set = (user: User | null) => {
      if (!alive) return;
      setState((prev) => (prev.ready && sameUser(prev.user, user) ? prev : { ready: true, user }));
    };

    void getCurrentUser().then(set, () => set(null));
    // The client loads lazily (keeps supabase-js out of every page's first-load
    // JS). If we unmount before it arrives, don't subscribe at all; otherwise
    // the cleanup below drops the subscription. A new subscription immediately
    // receives INITIAL_SESSION, so nothing that happened while loading is missed.
    let unsubscribe: (() => void) | null = null;
    void loadSupabase().then(
      (supabase) => {
        if (!alive) return;
        const { data } = supabase.auth.onAuthStateChange((_event, session) => set(session?.user ?? null));
        unsubscribe = () => data.subscription.unsubscribe();
      },
      () => {}
    );
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The shared auth state. Must sit under <AuthProvider> (the locale layout). */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Never crash a page over this; behave as "not ready, nobody" and say why.
    if (typeof window !== "undefined") console.error("useAuth used outside <AuthProvider>");
    return { ready: false, user: null };
  }
  return ctx;
}
