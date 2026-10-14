// CAD Champions language choice (owner decision: EN default, sticky AR).
// Edge-safe: imported by middleware.ts (via cc-routing.ts) and by the client
// language switcher. Never reads Accept-Language.
//
// Priority: signed-in user's saved preference -> cc_locale cookie -> "en".

import type { Locale } from "@/i18n/routing";

import { CC_DEFAULT_LOCALE, CC_LOCALE_COOKIE, isCcLocale } from "./routes";

export { CC_LOCALE_COOKIE };

/** One year, in seconds. */
export const CC_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ResolveCcLocaleInput = {
  /** Raw value of the cc_locale cookie (anything, or missing). */
  cookie?: string | null;
  // TODO(Prompt 2): add `profileLocale?: string | null` =
  // cc_profiles.preferred_locale of the signed-in user and check it FIRST.
  // The sign-in flow also writes the cc_locale cookie from the profile, so the
  // middleware (which cannot query the database) stays correct via the cookie.
};

/** The CC locale for a visitor: saved preference (Prompt 2) -> cookie -> "en". */
export function resolveCcLocale({ cookie }: ResolveCcLocaleInput): Locale {
  if (isCcLocale(cookie)) return cookie;
  return CC_DEFAULT_LOCALE;
}

/** The Set-Cookie / document.cookie string that remembers the CC language. */
export function ccLocaleCookieString(locale: Locale, { secure = false }: { secure?: boolean } = {}): string {
  return `${CC_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${CC_LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Client only: remember the CC language for one year. Never throws. */
export function writeCcLocaleCookie(locale: Locale): void {
  try {
    if (typeof document === "undefined") return;
    document.cookie = ccLocaleCookieString(locale, { secure: window.location.protocol === "https:" });
  } catch {
    // Cookies blocked: the URL still carries the locale, nothing else breaks.
  }
}
