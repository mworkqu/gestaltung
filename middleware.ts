import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";
import {
  SITE_V2_PREVIEW_COOKIE,
  SITE_V2_PREVIEW_COOKIE_VALUE,
  parseSiteV2Rows,
  siteV2Affects,
  siteV2Route,
  type SiteV2Decision,
} from "./lib/site-v2";

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

// ── site_v2 flag (P3-03, lib/site-v2.ts) ────────────────────────────────────
// Read ONLY for paths the flag can change (siteV2Affects): the locale home,
// /how-it-works, /design, /store (without listing params) and /:locale/v2….
// Plain PostgREST fetch with the anon key — never the cookie client, so a
// public response never gains a Set-Cookie. Cached per instance for 60 s (OFF
// too); any error, timeout, missing env or missing row = OFF (fail closed).
const FLAG_TTL_MS = 60_000;
const FLAG_TIMEOUT_MS = 1_500;
let flagCache: { on: boolean; at: number } | null = null;
let flagInFlight: Promise<boolean> | null = null;

async function fetchSiteV2Flag(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  try {
    const res = await fetch(`${url}/rest/v1/store_settings?key=eq.site_v2&select=value`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(FLAG_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return false;
    return parseSiteV2Rows(await res.json());
  } catch {
    return false;
  }
}

async function siteV2Flag(): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  flagInFlight ??= fetchSiteV2Flag()
    .then((on) => {
      flagCache = { on, at: Date.now() };
      return on;
    })
    .finally(() => {
      flagInFlight = null;
    });
  return flagInFlight;
}

/**
 * Applies a rewrite / not-found decision on top of next-intl's pass-through
 * response: same request headers next-intl would forward (incl. its locale
 * header — the locale is the first segment of both URLs), plus next-intl's
 * own response headers (the hreflang Link). Next's internal x-middleware-*
 * headers are not copied; NextResponse.rewrite sets its own.
 */
function rewriteFrom(request: NextRequest, intl: NextResponse, to: string, locale: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("X-NEXT-INTL-LOCALE", locale);
  const res = NextResponse.rewrite(new URL(to, request.url), { request: { headers } });
  intl.headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith("x-middleware-")) res.headers.set(key, value);
  });
  return res;
}

async function applySiteV2(request: NextRequest, intl: NextResponse): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (!siteV2Affects(pathname, search)) return intl;
  // next-intl redirected (or otherwise answered): leave its answer alone.
  if (intl.headers.has("location") || intl.status >= 300) return intl;

  const decision: SiteV2Decision = siteV2Route({
    pathname,
    search,
    flagOn: await siteV2Flag(),
    hasPreviewCookie: request.cookies.get(SITE_V2_PREVIEW_COOKIE)?.value === SITE_V2_PREVIEW_COOKIE_VALUE,
  });
  const locale = pathname.split("/")[1];

  switch (decision.kind) {
    case "none":
      return intl;
    case "redirect":
      return NextResponse.redirect(new URL(decision.to, request.url), 308);
    case "rewrite":
    case "notFound":
      return rewriteFrom(request, intl, decision.to, locale);
  }
}

export default async function middleware(request: NextRequest) {
  // 1) Run next-intl first so /[locale] routing + the EN/AR switcher decide the
  //    response (redirects, rewrites) exactly as before.
  const isLocalePrefixed = LOCALE_PREFIX.test(request.nextUrl.pathname);
  const intl = isLocalePrefixed ? handleI18nRouting(request) : handleRootRouting(request);

  // 2) site_v2 (P3-03): may turn next-intl's pass-through into a rewrite to
  //    /:locale/v2…, a 308 back to the public URL, or a 404. Untouched for
  //    every path the flag can't affect (no flag read there).
  const response = isLocalePrefixed ? await applySiteV2(request, intl) : intl;

  // 3) Refresh the Supabase session (only when the request has an auth cookie),
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
