import createMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";

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

export default async function middleware(request: NextRequest) {
  // 1) Run next-intl first so /[locale] routing + the EN/AR switcher decide the
  //    response (redirects, rewrites) exactly as before.
  const response = LOCALE_PREFIX.test(request.nextUrl.pathname)
    ? handleI18nRouting(request)
    : handleRootRouting(request);

  // 2) Refresh the Supabase session (only when the request has an auth cookie),
  //    writing rotated auth cookies onto that same response. Order matters:
  //    intl owns the response, auth augments it.
  return updateSession(request, response);
}

export const config = {
  // Skipped: api, Next internals, anything with a dot (files such as
  // /favicon.ico, /icon.svg, /manifest.webmanifest, /robots.txt) and the
  // generated metadata routes that have no extension (/apple-icon, /icon): those
  // must not be locale-redirected to /en/apple-icon.
  matcher: ["/((?!api|_next|_vercel|icon$|icon/|apple-icon$|apple-icon/|.*\\..*).*)"],
};
