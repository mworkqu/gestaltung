"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// Browser-side CAD Champions session, for DISPLAY only (header account menu,
// landing call to action). The CC layout no longer reads the session on the
// server, so public CC pages can be prerendered. Nothing here grants access:
// every signed-in page and server action still enforces auth on the server
// (requireCcUser / requireCcStaff / requireCcAdmin).

/** What the header needs to know about the visitor. */
export type CcHeaderSession = {
  name: string | null;
  email: string | null;
  isStaff: boolean;
} | null;

export type CcSessionState = { status: "loading" | "ready"; session: CcHeaderSession };

const LOADING: CcSessionState = { status: "loading", session: null };
const CcSessionContext = React.createContext<CcSessionState>(LOADING);

export function useCcSession(): CcSessionState {
  return React.useContext(CcSessionContext);
}

type ProfileSummary = { name: string | null; isStaff: boolean };
type SummaryCache = { userId: string | null; summary: ProfileSummary | null };

async function readSession(cache: SummaryCache): Promise<CcHeaderSession> {
  const supabase = createClient();
  // getSession() reads the session cookie locally (no network round trip); the
  // server re-validates it on every protected request.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user || user.is_anonymous) {
    cache.userId = null;
    cache.summary = null;
    return null;
  }
  if (cache.userId !== user.id || !cache.summary) {
    const [cc, site] = await Promise.all([
      supabase.from("cc_profiles").select("full_name,role").eq("id", user.id).maybeSingle<{ full_name: string | null; role: string | null }>(),
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>(),
    ]);
    const role = site.data?.role === "super_admin" ? "admin" : (cc.data?.role ?? null);
    cache.userId = user.id;
    cache.summary = { name: cc.data?.full_name ?? null, isStaff: role === "admin" || role === "instructor" };
  }
  return { name: cache.summary.name, email: user.email ?? null, isStaff: cache.summary.isStaff };
}

export function CcSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<CcSessionState>(LOADING);
  const cacheRef = React.useRef<SummaryCache>({ userId: null, summary: null });
  const pathname = usePathname();

  const refresh = React.useCallback(async () => {
    try {
      const session = await readSession(cacheRef.current);
      setState({ status: "ready", session });
    } catch {
      // Supabase not configured / offline: behave as signed out.
      setState({ status: "ready", session: null });
    }
  }, []);

  // On mount and after every client navigation (sign-in and sign-out set the
  // cookie on the server, so the header re-checks when the page changes).
  React.useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = createClient().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
          // Defer: supabase-js forbids awaiting its own calls inside this callback.
          window.setTimeout(() => void refresh(), 0);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // not configured
    }
    return () => unsubscribe?.();
  }, [refresh]);

  return <CcSessionContext.Provider value={state}>{children}</CcSessionContext.Provider>;
}
