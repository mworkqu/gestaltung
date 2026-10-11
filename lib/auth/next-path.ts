import { routing } from "@/i18n/routing";

// Where to go after signing in / up (W1, 2026-10-11).
//
// Every sign-in or sign-up link reached while a guest has work in progress
// carries ?next=<the page they were on, incl. ?step=>. The forms send them
// back there. `next` comes from the URL, so it is untrusted: only a
// same-origin path under one of our locales is accepted (no scheme, no
// "//host", no backslashes, no control characters, never the auth pages
// themselves). Anything else = null and the caller falls back to the
// dashboard.
//
// Pure on purpose (no Next / React imports): unit-tested, and usable from
// server pages, client forms and route handlers alike.

const MAX_LEN = 1024;
/** Placeholder origin used only to let URL() normalise the path. */
const BASE = "https://next-path.invalid";
/** Never return to these (a loop through the auth forms). */
const AUTH_PATHS = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

function localeOf(pathname: string): string | null {
  return routing.locales.find((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)) ?? null;
}

/**
 * A safe, locale-prefixed path to return to, or null.
 * The path's locale is switched to `locale` when they differ (the visitor
 * changed the language on the sign-in page), so they keep their choice.
 */
export function safeNextPath(raw: unknown, locale: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LEN) return null;
  // Same-origin relative path only: one leading slash, no "//host", no "\" tricks, no control chars.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  const pathLocale = localeOf(url.pathname);
  if (!pathLocale) return null;
  const rest = url.pathname.slice(pathLocale.length + 1); // "" or "/…"
  const bare = (rest || "/").replace(/\/+$/, "") || "/";
  if (AUTH_PATHS.some((p) => bare === p || bare.startsWith(`${p}/`))) return null;

  const target = (routing.locales as readonly string[]).includes(locale) ? locale : pathLocale;
  return `/${target}${rest}${url.search}${url.hash}`;
}

/** Where to land after auth: the safe `next`, else the dashboard of that locale. */
export function afterAuthPath(raw: unknown, locale: string, fallback = "/dashboard"): string {
  return safeNextPath(raw, locale) ?? `/${locale}${fallback}`;
}

function authHref(page: "sign-in" | "sign-up", locale: string, currentPath: string | null | undefined): string {
  const base = `/${locale}/${page}`;
  const next = safeNextPath(currentPath ?? null, locale);
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * "/{locale}/sign-in?next=…" for a plain (non-i18n) link. `currentPath` is the
 * page the visitor is on, with its query (e.g. "/en/projects/x/studio?step=wiring").
 */
export function signInHref(locale: string, currentPath: string | null | undefined): string {
  return authHref("sign-in", locale, currentPath);
}

/** Same as signInHref, for the sign-up form. */
export function signUpHref(locale: string, currentPath: string | null | undefined): string {
  return authHref("sign-up", locale, currentPath);
}

/**
 * The "Create one" / "Sign in" switch between the two forms, as a
 * LOCALE-AGNOSTIC href for the i18n <Link> (it adds the locale), keeping an
 * already-validated `next`.
 */
export function authAltHref(page: "/sign-in" | "/sign-up", next: string | null | undefined): string {
  return next ? `${page}?next=${encodeURIComponent(next)}` : page;
}

/** True when `next` is a project page (the forms then say "…with your project"). */
export function returnsToProject(next: string | null | undefined): boolean {
  return !!next && /^\/[a-z]{2}\/projects\/[^/?#]+/.test(next);
}
