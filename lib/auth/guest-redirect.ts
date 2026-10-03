import { routing } from "@/i18n/routing";

// D5 (owner, 2026-10-03): a guest is a visitor with an ANONYMOUS Supabase
// session (user.is_anonymous === true). Guests keep their projects but have no
// dashboard or inventory, so those areas send them to /projects.
//
// Pure on purpose (no Next/Supabase imports) so the rule is unit-tested. The
// dashboard and inventory layouts call it; signed-out visitors are NOT handled
// here — those layouts still send them to /sign-in exactly as before.

export type GuestUserLike = { is_anonymous?: boolean | null } | null | undefined;

/** Paths (locale-agnostic) that guests may not open, with all their sub-routes. */
export const GUEST_BLOCKED_PREFIXES = ["/dashboard", "/inventory"] as const;

/** Where a guest lands instead (locale-agnostic). */
export const GUEST_HOME = "/projects";

/** True for a real account: a session that is not anonymous. */
export function hasAccount(user: GuestUserLike): boolean {
  return !!user && user.is_anonymous !== true;
}

/**
 * Redirect target for a guest opening `path`, or null when nothing changes.
 * `path` may carry a locale prefix ("/ar/dashboard/credits") or not
 * ("/dashboard"); the target keeps whichever form it was given. Query string
 * and hash are ignored.
 */
export function guestRedirect({ user, path }: { user: GuestUserLike; path: string }): string | null {
  if (!user || user.is_anonymous !== true) return null;

  const clean = path.split(/[?#]/)[0];
  const locale = routing.locales.find((l) => clean === `/${l}` || clean.startsWith(`/${l}/`));
  let bare = locale ? clean.slice(locale.length + 1) : clean;
  bare = bare.replace(/\/+$/, "") || "/";

  const blocked = GUEST_BLOCKED_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`));
  if (!blocked) return null;
  return locale ? `/${locale}${GUEST_HOME}` : GUEST_HOME;
}
