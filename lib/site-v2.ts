// site_v2 feature flag (P3-03, plan §5.4) — pure, edge-safe helpers shared by
// middleware.ts and /api/admin/site-v2-preview. No Node APIs, no Supabase
// client: the middleware reads the flag itself with a plain fetch.
//
// store_settings.site_v2 = {"enabled": false} (migration 0056). Only an
// explicit {"enabled": true} turns it ON; anything else (missing row, bad
// JSON, fetch error, timeout) is OFF — fail closed.
//
//   flag ON   /:locale + V2_PATHS     → rewrite to /:locale/v2 + path (the URL
//             stays public). /:locale/store WITH a listing param (q, category,
//             …) is left alone: next.config.mjs rewrites it to /store/search.
//             /:locale/v2…            → 308 to the public URL (one canonical URL).
//   flag OFF  public URLs untouched.
//             /:locale/v2…            → 404, unless the preview cookie
//             site_v2=1 is present (set by /api/admin/site-v2-preview for a
//             super_admin) — then it passes through.

import { routing } from "@/i18n/routing";

export const SITE_V2_KEY = "site_v2";
/** Preview cookie: `site_v2=1` lets /:locale/v2… render while the flag is OFF. */
export const SITE_V2_PREVIEW_COOKIE = "site_v2";
export const SITE_V2_PREVIEW_COOKIE_VALUE = "1";
/** 7 days, in seconds. */
export const SITE_V2_PREVIEW_MAX_AGE = 60 * 60 * 24 * 7;

/** Public paths (after the locale) that have a v2 page. "" = the locale home. */
export const V2_PATHS = ["", "/how-it-works", "/design", "/store"] as const;

/**
 * The /store listing params. Same list as lib/store/catalog.ts STORE_URL_PARAMS
 * and the beforeFiles rewrites in next.config.mjs (site-v2.test.ts checks) —
 * copied, not imported, so the middleware bundle stays tiny.
 */
export const STORE_LISTING_PARAMS = ["q", "category", "material", "stock", "sort", "page"] as const;

/** Where the not-found rewrite lands: no page matches it, so app/[locale]/[...rest] calls notFound() (404). */
export const V2_NOT_FOUND_SEGMENT = "/__v2-not-found";

/** Anything but an explicit `{"enabled": true}` is OFF. */
export function parseSiteV2(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).enabled === true;
}

/** PostgREST returns `[{value: …}]` for `?key=eq.site_v2&select=value`. */
export function parseSiteV2Rows(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const row = rows[0];
  if (!row || typeof row !== "object") return false;
  return parseSiteV2((row as Record<string, unknown>).value);
}

export type SiteV2Decision =
  | { kind: "none" }
  | { kind: "rewrite"; to: string }
  | { kind: "redirect"; to: string }
  | { kind: "notFound"; to: string };

type Match =
  | { type: "public"; locale: string; path: string }
  | { type: "v2"; locale: string; rest: string };

const LOCALES: readonly string[] = routing.locales;

/** Strips one trailing slash (never from the bare "/"). */
function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function match(pathname: string): Match | null {
  const p = trimSlash(pathname);
  const m = /^\/([^/]+)(\/.*)?$/.exec(p);
  if (!m || !LOCALES.includes(m[1])) return null;
  const locale = m[1];
  const rest = m[2] ?? "";
  if (rest === "/v2" || rest.startsWith("/v2/")) return { type: "v2", locale, rest: rest.slice(3) };
  if ((V2_PATHS as readonly string[]).includes(rest)) return { type: "public", locale, path: rest };
  return null;
}

function hasListingParam(search: string): boolean {
  const params = new URLSearchParams(search);
  return STORE_LISTING_PARAMS.some((k) => params.has(k));
}

/**
 * Can the flag change this request? The middleware reads the flag ONLY when
 * this is true — every other path never pays for the lookup.
 */
export function siteV2Affects(pathname: string, search: string): boolean {
  const m = match(pathname);
  if (!m) return false;
  if (m.type === "public" && m.path === "/store" && hasListingParam(search)) return false;
  return true;
}

export function siteV2Route(input: {
  pathname: string;
  search: string;
  flagOn: boolean;
  hasPreviewCookie: boolean;
}): SiteV2Decision {
  const { pathname, search, flagOn, hasPreviewCookie } = input;
  const m = match(pathname);
  if (!m) return { kind: "none" };
  const qs = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";

  if (m.type === "public") {
    if (!flagOn) return { kind: "none" };
    if (m.path === "/store" && hasListingParam(search)) return { kind: "none" };
    return { kind: "rewrite", to: `/${m.locale}/v2${m.path}${qs}` };
  }

  // /:locale/v2…
  if (flagOn) return { kind: "redirect", to: `/${m.locale}${m.rest}${qs}` };
  if (hasPreviewCookie) return { kind: "none" };
  return { kind: "notFound", to: `/${m.locale}${V2_NOT_FOUND_SEGMENT}` };
}

// ── /api/admin/site-v2-preview ──────────────────────────────────────────────

export type PreviewRequest = { on: boolean; locale: string };

/** `?on=0` turns the preview off; `?locale=en|ar` (default en). */
export function parsePreviewRequest(params: URLSearchParams): PreviewRequest {
  const locale = params.get("locale");
  return {
    on: params.get("on") !== "0",
    locale: locale && LOCALES.includes(locale) ? locale : routing.defaultLocale,
  };
}

/** Where the preview route sends the browser afterwards. */
export function previewRedirectPath({ on, locale }: PreviewRequest): string {
  return on ? `/${locale}/v2` : `/${locale}`;
}

export function previewCookieOptions(production: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    maxAge: SITE_V2_PREVIEW_MAX_AGE,
  };
}
