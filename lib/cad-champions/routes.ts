// CAD Champions URL scheme (Prompt 1, Option 1).
//
// Public URLs are /cad-champions/{en,ar}/… ; middleware.ts rewrites them to
// the internal route app/[locale]/cad-champions/… (so the site's [locale]
// layout sets <html lang dir> from the locale). Always build CC links with
// ccPath() — never with the site's next-intl <Link>, which would produce the
// internal /ar/cad-champions/… form (middleware 308s that to the public form).

import type { Locale } from "@/i18n/routing";

export const CC_BASE = "/cad-champions";
export const CC_LOCALES = ["en", "ar"] as const satisfies readonly Locale[];
export const CC_DEFAULT_LOCALE: Locale = "en";
/** Remembers the visitor's CC language (owner decision: EN default, sticky AR). */
export const CC_LOCALE_COOKIE = "cc_locale";

export function isCcLocale(value: unknown): value is Locale {
  return typeof value === "string" && (CC_LOCALES as readonly string[]).includes(value);
}

/** Public URL for a CC page, e.g. ccPath("ar", "/dashboard") -> "/cad-champions/ar/dashboard". */
export function ccPath(locale: Locale, path = "/"): string {
  const clean = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${CC_BASE}/${locale}${clean}`;
}

/**
 * Splits a public CC pathname into { locale, rest }. Returns null when the
 * path is not under /cad-champions; locale is null when the second segment is
 * not a CC locale (e.g. bare /cad-champions or /cad-champions/dashboard).
 */
export function parseCcPath(pathname: string): { locale: Locale | null; rest: string } | null {
  if (pathname !== CC_BASE && !pathname.startsWith(`${CC_BASE}/`)) return null;
  const after = pathname.slice(CC_BASE.length); // "" | "/ar" | "/ar/x" | "/x"
  const seg = after.split("/")[1] ?? "";
  if (isCcLocale(seg)) {
    const rest = after.slice(1 + seg.length);
    return { locale: seg, rest: rest === "" ? "/" : rest };
  }
  return { locale: null, rest: after === "" ? "/" : after };
}

/** The same page in the other language (used by the CC language switcher). */
export function ccSwitchLocale(pathname: string, to: Locale): string {
  const parsed = parseCcPath(pathname);
  return ccPath(to, parsed ? parsed.rest : "/");
}
