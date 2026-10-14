// CAD Champions auth paths (pure, edge-safe, unit-tested in paths.test.ts).
// Used by middleware.ts (route protection), the server auth helpers
// (lib/cad-champions/auth/server.ts) and the auth forms.
//
// `next` always comes from a URL, so it is untrusted: only a same-origin
// public CC path (/cad-champions/{en|ar}/…) is accepted. Anything else falls
// back to the dashboard. The auth pages themselves are never a `next` target
// (that would loop through the forms).

import type { Locale } from "@/i18n/routing";

import { CC_BASE, ccPath, isCcLocale } from "../routes";

/** Pages that need a signed-in CC user (the part after /cad-champions/{locale}). Help stays public. */
export const CC_PROTECTED_PREFIXES = [
  "/dashboard",
  "/get-ready",
  "/test",
  "/results",
  "/training",
  "/admin",
  "/onboarding",
  "/account",
] as const;

/** Pages that also need the instructor or admin role (checked server-side). */
export const CC_STAFF_PREFIXES = ["/admin"] as const;

/** Where a signed-in user lands when there is no (valid) `next`. */
export const CC_DEFAULT_NEXT = "/dashboard";

/** Auth screens: never a `next` target. */
export const CC_AUTH_PAGES = [
  "/sign-in",
  "/sign-up",
  "/check-email",
  "/forgot-password",
  "/reset-password",
  "/auth",
] as const;

/** sessionStorage key for the address shown on the check-email screen (never put in the URL). */
export const CC_PENDING_EMAIL_KEY = "cc:pending-email";

/** Seconds between "Resend email" presses. */
export const CC_RESEND_COOLDOWN_SEC = 60;

const MAX_LEN = 1024;
const BASE = "https://cc-next.invalid";
const CC_PATH_RE = new RegExp(`^${CC_BASE}/([^/]+)(/.*)?$`);

/** "/dashboard/x?y" -> "/dashboard/x"; "" -> "/"; trailing slashes dropped. */
function cleanRest(rest: string): string {
  const path = rest.split(/[?#]/)[0] ?? "";
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function matches(rest: string, prefixes: readonly string[]): boolean {
  const r = cleanRest(rest);
  return prefixes.some((p) => r === p || r.startsWith(`${p}/`));
}

/** True when the page (rest of a CC path, e.g. "/dashboard") needs a signed-in user. */
export function isCcProtected(rest: string): boolean {
  return matches(rest, CC_PROTECTED_PREFIXES);
}

/** True when the page needs the instructor or admin role. */
export function isCcStaffPath(rest: string): boolean {
  return matches(rest, CC_STAFF_PREFIXES);
}

/**
 * The validated public CC path for `raw` (with its query and hash), switched
 * to `locale`, or null when `raw` is not a safe CC page.
 */
export function ccNextOrNull(raw: unknown, locale: Locale): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LEN) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  const m = url.pathname.match(CC_PATH_RE);
  if (!m || !isCcLocale(m[1])) return null;
  const rest = m[2] ?? "/";
  if (matches(rest, CC_AUTH_PAGES)) return null;

  const target: Locale = isCcLocale(locale) ? locale : m[1];
  return `${ccPath(target, cleanRest(rest))}${url.search}${url.hash}`;
}

/** Where to go after signing in: the safe `next` (in `locale`), else the dashboard. */
export function safeCcNext(raw: unknown, locale: Locale): string {
  return ccNextOrNull(raw, locale) ?? ccPath(locale, CC_DEFAULT_NEXT);
}

function withNext(base: string, locale: Locale, next: string | null | undefined): string {
  const safe = ccNextOrNull(next ?? null, locale);
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base;
}

/** "/cad-champions/{locale}/sign-in" plus ?next=<safe CC path> when `next` is one. */
export function ccSignInHref(locale: Locale, next?: string | null): string {
  return withNext(ccPath(locale, "/sign-in"), locale, next);
}

/** Same as ccSignInHref, for the sign-up page. */
export function ccSignUpHref(locale: Locale, next?: string | null): string {
  return withNext(ccPath(locale, "/sign-up"), locale, next);
}

/**
 * The CC route that finishes every sign-in (password, email link, confirmed
 * sign-up): creates a missing cc_profiles row from the sign-up data, sets the
 * cc_locale cookie from the profile, then redirects to `next`.
 * app/[locale]/cad-champions/auth/continue/route.ts
 */
export function ccContinueHref(locale: Locale, next?: string | null): string {
  return withNext(ccPath(locale, "/auth/continue"), locale, next);
}

/**
 * The Supabase email-link target: the site's /api/auth/callback (exchanges the
 * code, then redirects to `afterPath`, a public CC path). The callback URL
 * must be on Supabase's redirect allow-list (…/api/auth/callback**), see
 * docs/cad-champions/AUTH_EMAILS.md.
 */
export function ccCallbackUrl(origin: string, afterPath: string): string {
  return `${origin.replace(/\/+$/, "")}/api/auth/callback?next=${encodeURIComponent(afterPath)}`;
}
