import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuthUser, getSessionContext, type SessionContext } from "@/lib/auth/get-session";
import { guestRedirect } from "@/lib/auth/guest-redirect";
import { jsonError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

// Page-level auth guards (audit WEB-02 / WEB-08).
//
// Next renders a page without running the layouts the client says it already
// has (router-state header), so a role check that lives only in a layout does
// not protect the page. Every admin page therefore calls requireSuperAdmin()
// itself; the layouts keep their checks as defence in depth.
//
// The reads are wrapped in React cache(), so the dashboard layout, a sub-layout
// and the page together cost one getUser() + one profile read per request.

/** The current auth user, read once per request. */
export const getAuthUserCached = cache(getAuthUser);

/** The current session (user + profile + tenant), read once per request. */
export const getSessionContextCached = cache(
  async (): Promise<SessionContext | null> => getSessionContext(await getAuthUserCached())
);

/**
 * Same gate as the dashboard layout: a guest (anonymous session) goes to their
 * projects (D5), a signed-out visitor to sign-in. Returns the session.
 */
export async function requireSignedIn(locale: string): Promise<SessionContext> {
  const user = await getAuthUserCached();
  const guestTarget = guestRedirect({ user, path: `/${locale}/dashboard` });
  if (guestTarget) redirect(guestTarget);

  const session = await getSessionContextCached();
  if (!session) redirect(`/${locale}/sign-in`);
  return session;
}

/**
 * requireSignedIn + the super_admin role; any other signed-in user goes back to
 * the dashboard home (exactly what the admin sub-layouts do).
 */
export async function requireSuperAdmin(locale: string): Promise<SessionContext> {
  const session = await requireSignedIn(locale);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);
  return session;
}

// Route-handler guards. Pages and actions redirect (above); an API route answers
// with a Response, so these return a result the route unwraps:
//
//   const auth = await requireUser();
//   if (!auth.ok) return auth.response;
//   const { user, supabase } = auth;
//
// The cookie-bound client reads the session from next/headers, so no Request is
// needed. 401 `{ error: "sign_in" }` is the most common body the routes answer
// today (10 routes, against 9 empty-body 401s), and the one clients already
// read. A guest session is a real Supabase user (is_anonymous), so it passes by
// default; use requireAccount() where a guest must not.

export type RequireUserOptions = {
  /** Let an anonymous guest session through. Default true. */
  allowAnonymous?: boolean;
};

export type RouteAuth =
  | { ok: true; user: User; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: Response };

/** The signed-in user (guests included unless `allowAnonymous: false`), or a 401 `{ error: "sign_in" }`. */
export async function requireUser(opts: RequireUserOptions = {}): Promise<RouteAuth> {
  const { allowAnonymous = true } = opts;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || (!allowAnonymous && user.is_anonymous)) {
    return { ok: false, response: jsonError("sign_in", 401) };
  }
  return { ok: true, user, supabase };
}

/** requireUser for a real account: an anonymous guest session gets the same 401 as a signed-out visitor. */
export function requireAccount(): Promise<RouteAuth> {
  return requireUser({ allowAnonymous: false });
}

/**
 * Non-redirecting super_admin check for route handlers that answer 403
 * themselves (each keeps its own body: most send an empty 403):
 *
 *   const session = await getSessionContext();
 *   if (!isSuperAdminSession(session)) return emptyStatus(403);
 *
 * Takes the session so the route can keep using it afterwards.
 */
export function isSuperAdminSession(session: SessionContext | null | undefined): session is SessionContext {
  return session?.profile.role === "super_admin";
}
