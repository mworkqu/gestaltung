import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";
import { hasSupabaseAuthCookie } from "./lib/supabase/auth-cookie";
import { ccRoute, type CcRouteDecision } from "./lib/cad-champions/cc-routing";
import { ccSignInHref, isCcProtected } from "./lib/cad-champions/auth/paths";
import { CC_LOCALE_COOKIE, parseCcPath } from "./lib/cad-champions/routes";
import { applyCcSecurityHeaders } from "./lib/cad-champions/security-headers";

// "/" or any path without a locale prefix: the full next-intl routing, which
// reads the NEXT_LOCALE cookie (and Accept-Language) to pick the locale and
// redirects (a redirect is never cached as a page anyway).
const handleRootRouting = createMiddleware(routing);
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(/|$)`);
// Every locale-prefixed page: the locale is in the URL, so the middleware never
// writes NEXT_LOCALE (Phase G: keeps public responses free of Set-Cookie, i.e.
// cacheable). The language switcher still remembers the choice: next-intl's
// client navigation (i18n/navigation.ts, routing.localeCookie on) writes the
// cookie in the browser when the visitor switches.
const handleI18nRouting = createMiddleware({ ...routing, localeCookie: false });

// ── CAD Champions (Prompt 1) ────────────────────────────────────────────────
// Handles ONLY /cad-champions… and the internal /{en|ar}/cad-champions… form
// (lib/cad-champions/cc-routing.ts decides); every other path returns "none"
// and runs through the site code below exactly as before. next-intl never sees
// a CC path (it would redirect /cad-champions to /en/cad-champions).
// noindex on every CC response until Prompt 12.
const CC_ROBOTS = "noindex, nofollow";

async function handleCc(request: NextRequest, cc: Exclude<CcRouteDecision, { kind: "none" }>): Promise<NextResponse> {
  const rest = parseCcPath(request.nextUrl.pathname)?.rest ?? "/";
  if (cc.kind === "redirect") {
    const res = NextResponse.redirect(new URL(cc.to, request.url), cc.status);
    res.headers.set("X-Robots-Tag", CC_ROBOTS);
    applyCcSecurityHeaders(res.headers);
    // 307 depends on the visitor's cc_locale cookie: never cache it.
    if (cc.status === 307) res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  // Prompt 2 Step F: a protected CC page (lib/cad-champions/auth/paths.ts)
  // without any Supabase auth cookie goes straight to sign-in, returning here
  // afterwards. Only a fast pre-check: the page itself verifies the session and
  // the role server-side (requireCcUser / requireCcStaff).
  if (isCcProtected(rest) && !hasSupabaseAuthCookie(request.cookies.getAll().map((c) => c.name))) {
    const target = ccSignInHref(cc.locale, request.nextUrl.pathname + request.nextUrl.search);
    const res = NextResponse.redirect(new URL(target, request.url), 307);
    res.headers.set("X-Robots-Tag", CC_ROBOTS);
    applyCcSecurityHeaders(res.headers);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }

  // Public /cad-champions/{locale}/rest -> internal /{locale}/cad-champions/rest,
  // with next-intl's locale header (X-NEXT-INTL-LOCALE), then the usual
  // Supabase session refresh on that response.
  const headers = new Headers(request.headers);
  headers.set("X-NEXT-INTL-LOCALE", cc.locale);
  const res = NextResponse.rewrite(new URL(cc.to, request.url), { request: { headers } });
  res.headers.set("X-Robots-Tag", CC_ROBOTS);
  // Prompt 12 Step A: CC-only security headers (lib/cad-champions/security-headers.ts);
  // only the public shared-result page may be framed.
  applyCcSecurityHeaders(res.headers, rest);
  return updateSession(request, res);
}

export default async function middleware(request: NextRequest) {
  // 0) CAD Champions: its own branch, before anything of the site runs.
  const cc = ccRoute(
    request.nextUrl.pathname,
    request.nextUrl.search,
    request.cookies.get(CC_LOCALE_COOKIE)?.value,
  );
  if (cc.kind !== "none") return handleCc(request, cc);

  // 1) Run next-intl first so /[locale] routing + the EN/AR switcher decide the
  //    response (redirects, rewrites) exactly as before.
  const isLocalePrefixed = LOCALE_PREFIX.test(request.nextUrl.pathname);
  const intl = isLocalePrefixed ? handleI18nRouting(request) : handleRootRouting(request);

  // 2) Refresh the Supabase session (only when the request has an auth cookie),
  //    writing rotated auth cookies onto that same response. Order matters:
  //    intl owns the response, auth augments it.
  return updateSession(request, intl);
}

export const config = {
  // Skipped: api, Next internals, anything with a dot (files such as
  // /favicon.ico, /icon.svg, /manifest.webmanifest, /robots.txt) and the
  // generated metadata routes that have no extension (/apple-icon, /icon): those
  // must not be locale-redirected to /en/apple-icon.
  matcher: ["/((?!api|_next|_vercel|icon$|icon/|apple-icon$|apple-icon/|.*\\..*).*)"],
};
