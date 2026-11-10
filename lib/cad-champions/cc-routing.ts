// CAD Champions routing decisions (pure, edge-safe, unit-tested in
// cc-routing.test.ts). middleware.ts applies them; nothing here touches Next.
//
// Public URLs:   /cad-champions/{en|ar}/…          -> rewrite to the internal route
// Internal URLs: /{en|ar}/cad-champions/…          -> 308 to the public form
// No locale:     /cad-champions, /cad-champions/x  -> 307 to the visitor's CC locale
// Anything else  -> "none" (the site middleware runs exactly as before).

import type { Locale } from "@/i18n/routing";

import { resolveCcLocale } from "./locale";
import { CC_BASE, CC_LOCALES, ccPath, parseCcPath } from "./routes";

export type CcRouteDecision =
  | { kind: "none" }
  | { kind: "rewrite"; to: string; locale: Locale }
  | { kind: "redirect"; to: string; status: 307 | 308 };

const INTERNAL_FORM = new RegExp(`^/(${CC_LOCALES.join("|")})${CC_BASE}(/.*)?$`);

/**
 * What the middleware should do with a request. `search` is the raw query
 * string ("" or "?x=1") and is kept on every rewrite and redirect.
 * `cookieLocale` is the cc_locale cookie value (anything, or undefined).
 */
export function ccRoute(pathname: string, search: string, cookieLocale?: string | null): CcRouteDecision {
  const internal = pathname.match(INTERNAL_FORM);
  if (internal) {
    const locale = internal[1] as Locale;
    return { kind: "redirect", to: ccPath(locale, internal[2] ?? "/") + search, status: 308 };
  }

  const parsed = parseCcPath(pathname);
  if (!parsed) return { kind: "none" };

  if (!parsed.locale) {
    // 307 (temporary, never cached): the target depends on the visitor.
    const locale = resolveCcLocale({ cookie: cookieLocale });
    return { kind: "redirect", to: ccPath(locale, parsed.rest) + search, status: 307 };
  }

  const rest = parsed.rest === "/" ? "" : parsed.rest;
  return { kind: "rewrite", to: `/${parsed.locale}${CC_BASE}${rest}${search}`, locale: parsed.locale };
}

/**
 * True for any CC page pathname, in every form a client hook can report:
 * the public URL (/cad-champions/ar/x), next-intl's locale-stripped form of
 * the internal route (/cad-champions/x) and the internal route itself
 * (/ar/cad-champions/x, which a statically prerendered page can carry in its
 * server HTML). Used by the site's Header/Trust/Footer gates.
 */
export function isCcPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return parseCcPath(pathname) !== null || INTERNAL_FORM.test(pathname);
}

/**
 * The public pathname of a CC page from whatever usePathname() returned
 * (public or internal form). Server HTML of a prerendered page and the
 * browser can disagree on the form; normalising keeps hrefs identical.
 */
export function ccPublicPathname(pathname: string | null | undefined): string {
  if (!pathname) return CC_BASE;
  const internal = pathname.match(INTERNAL_FORM);
  if (internal) return ccPath(internal[1] as Locale, internal[2] ?? "/");
  return pathname;
}
