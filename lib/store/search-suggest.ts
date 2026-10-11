// Instant store search (W7): the pure side of GET /api/store/search?q=.
// The route only wires the cached catalogue read (getStoreListing, already
// ranked by lib/store/search.ts and matching EN + AR names) and the rate
// limiter into handleStoreSearch, so the whole contract is unit-tested here.

import type { StoreCardPart } from "@/lib/store/catalog";
import { parseStoreParams } from "@/lib/store/catalog";
import type { LeadTimeClass } from "@/lib/store/sourcing";
import { partImageUrl } from "@/lib/parts/format";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";

/** Results shown in the dropdown. */
export const SUGGEST_LIMIT = 6;
/** Shorter queries return nothing (one letter matches half the catalogue). */
export const SUGGEST_MIN_CHARS = 2;
/** Same cap as the store search box. */
export const SUGGEST_MAX_CHARS = 100;
/** Per IP, per server instance. Typing with a 200 ms debounce stays far below it. */
export const SUGGEST_RATE = { limit: 60, windowMs: 60_000 } as const;
/** CDN cache for one query: the catalogue itself is cached for 5 minutes. */
export const SUGGEST_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

/**
 * The ONLY fields a suggestion carries (public card fields). Never cost,
 * supplier, margin or anything else from the parts row.
 */
export type StoreSuggestion = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  unit_price: number;
  /** Small, resized product photo, or null (the dropdown shows a placeholder). */
  thumb: string | null;
  lead_time_class: LeadTimeClass | null;
  min_order_qty: number;
};

export type StoreSearchResponse = { q: string; results: StoreSuggestion[]; total: number };

export const SUGGESTION_FIELDS = [
  "id",
  "sku",
  "name",
  "name_ar",
  "unit_price",
  "thumb",
  "lead_time_class",
  "min_order_qty",
] as const satisfies readonly (keyof StoreSuggestion)[];

/** Collapse whitespace, trim, cap the length. */
export function normalizeSuggestQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SUGGEST_MAX_CHARS);
}

export function suggestLocale(raw: string | null | undefined): "en" | "ar" {
  return raw === "ar" ? "ar" : "en";
}

/** Whitelist one card: copies the public fields by name, nothing else survives. */
export function toSuggestion(p: StoreCardPart & Record<string, unknown>): StoreSuggestion {
  const img = partImageUrl(p);
  return {
    id: String(p.id),
    sku: String(p.sku),
    name: String(p.name),
    name_ar: typeof p.name_ar === "string" && p.name_ar.trim() ? p.name_ar : null,
    unit_price: Number(p.unit_price) || 0,
    thumb: img ? sizedImage(img, IMAGE_WIDTHS.thumb) : null,
    lead_time_class: (p.lead_time_class ?? null) as LeadTimeClass | null,
    min_order_qty: Math.max(1, Math.trunc(Number(p.min_order_qty)) || 1),
  };
}

export type StoreSearchDeps = {
  listing: (q: string, locale: "en" | "ar") => Promise<{ parts: StoreCardPart[]; total: number }>;
  rate: { hit(key: string): { allowed: boolean; retryAfterSec: number } };
};

/** The route: rate limit → normalise → cached ranked listing → top 6, whitelisted. */
export async function handleStoreSearch(request: Request, deps: StoreSearchDeps, ip: string): Promise<Response> {
  const { allowed, retryAfterSec } = deps.rate.hit(ip);
  if (!allowed) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec), "Cache-Control": "no-store" } },
    );
  }
  const url = new URL(request.url);
  const q = normalizeSuggestQuery(url.searchParams.get("q"));
  const locale = suggestLocale(url.searchParams.get("locale"));
  const headers = { "Cache-Control": SUGGEST_CACHE_CONTROL };
  if (q.length < SUGGEST_MIN_CHARS) {
    return Response.json({ q, results: [], total: 0 } satisfies StoreSearchResponse, { headers });
  }
  try {
    const { parts, total } = await deps.listing(q, locale);
    const results = parts.slice(0, SUGGEST_LIMIT).map((p) => toSuggestion(p as StoreCardPart & Record<string, unknown>));
    return Response.json({ q, results, total } satisfies StoreSearchResponse, { headers });
  } catch (err) {
    console.warn("[store/search] listing failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** The store listing state for a suggestion query (relevance sort, first page). */
export const suggestState = (q: string) => parseStoreParams({ q });
