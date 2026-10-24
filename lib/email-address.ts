// The one "does this look like an email address" check: something@something.something,
// no whitespace. Deliberately loose, the same rule as the SQL function
// public.is_plausible_email, so client, server and database agree. It is a typo
// guard, not deliverability proof. Pure, safe in the browser.

const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Identical to lib/store/shipping.ts isPlausibleEmail: trims, treats null/undefined
 * as empty. Returns a plain boolean on purpose; a `v is string` predicate would
 * narrow a rejected string to `never` in the false branch.
 */
export function isPlausibleEmail(email: string | null | undefined): boolean {
  return PLAUSIBLE_EMAIL.test((email ?? "").trim());
}

/**
 * Type-guard variant (lib/notifications/decide.ts isPlausibleEmail): also false
 * for non-strings. Use it where the value must be narrowed to `string` and the
 * false branch does not touch the value again.
 */
export function isEmailString(v: unknown): v is string {
  return typeof v === "string" && PLAUSIBLE_EMAIL.test(v.trim());
}
