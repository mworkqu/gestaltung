import { describe, expect, it, vi } from "vitest";

import { createRateLimiter, clientIp } from "@/lib/rate-limit";
import type { StoreCardPart } from "@/lib/store/catalog";
import {
  handleStoreSearch,
  normalizeSuggestQuery,
  SUGGEST_CACHE_CONTROL,
  SUGGESTION_FIELDS,
  suggestState,
  toSuggestion,
  type StoreSearchDeps,
} from "./search-suggest";

const card = (i: number, extra: Record<string, unknown> = {}): StoreCardPart =>
  ({
    id: `id-${i}`,
    sku: `VLT-${i}`,
    name: `DC Motor ${i}`,
    name_ar: `محرك ${i}`,
    unit_price: 10 + i,
    image_url: `https://cdn.shopify.com/s/files/motor-${i}.jpg`,
    category: "Motors",
    min_order_qty: 1,
    lead_time_class: "in_stock",
    ...extra,
  }) as StoreCardPart;

const okRate = { hit: () => ({ allowed: true, retryAfterSec: 0 }) };
const req = (qs: string) => new Request(`http://localhost/api/store/search${qs}`);

function deps(parts: StoreCardPart[], total = parts.length): StoreSearchDeps & { listing: ReturnType<typeof vi.fn> } {
  return { listing: vi.fn(async () => ({ parts, total })), rate: okRate };
}

describe("toSuggestion field whitelist", () => {
  it("keeps only the public fields, even when the row carries private ones", () => {
    const row = card(1, {
      landed_cost_qar: 4.2,
      expected_income_qar: 3,
      income_pct: 40,
      supplier: "voltaat",
      description: "long text",
      category: "Motors",
    });
    const s = toSuggestion(row as StoreCardPart & Record<string, unknown>);
    expect(Object.keys(s).sort()).toEqual([...SUGGESTION_FIELDS].sort());
    expect(s).not.toHaveProperty("landed_cost_qar");
    expect(s).not.toHaveProperty("image_url");
    expect(s.thumb).toContain("width=140");
  });

  it("normalises empty Arabic names, missing photos and bad numbers", () => {
    const s = toSuggestion(card(2, { name_ar: "  ", image_url: "[link removed]", min_order_qty: 0, lead_time_class: null }) as never);
    expect(s.name_ar).toBeNull();
    expect(s.thumb).toBeNull();
    expect(s.min_order_qty).toBe(1);
    expect(s.lead_time_class).toBeNull();
  });
});

describe("query handling", () => {
  it("suggests from a three-letter prefix (F-029: no whole word needed)", async () => {
    const d = deps([card(1)]);
    const res = await handleStoreSearch(req("?q=mot"), d, "1.1.1.1");
    const body = await res.json();
    expect(d.listing).toHaveBeenCalledWith("mot", "en");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].thumb).not.toBeNull();
  });

  it("collapses spaces, trims and caps at 100 chars", () => {
    expect(normalizeSuggestQuery("  dc   motor ")).toBe("dc motor");
    expect(normalizeSuggestQuery(null)).toBe("");
    expect(normalizeSuggestQuery("x".repeat(300))).toHaveLength(100);
  });

  it("uses the relevance sort on the first page", () => {
    expect(suggestState("dc motor")).toMatchObject({ q: "dc motor", sort: "relevance", page: 1 });
  });

  it("returns nothing for queries under two characters without reading the catalogue", async () => {
    const d = deps([card(1)]);
    const res = await handleStoreSearch(req("?q=%20a%20"), d, "1.1.1.1");
    expect(await res.json()).toEqual({ q: "a", results: [], total: 0 });
    expect(d.listing).not.toHaveBeenCalled();
  });

  it("returns the top 6 with the total, cached, and passes the locale (EN and AR)", async () => {
    const d = deps(Array.from({ length: 9 }, (_, i) => card(i)), 42);
    const res = await handleStoreSearch(req("?q=dc%20motor&locale=ar"), d, "1.1.1.1");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(SUGGEST_CACHE_CONTROL);
    expect(body.results).toHaveLength(6);
    expect(body.total).toBe(42);
    expect(d.listing).toHaveBeenCalledWith("dc motor", "ar");

    const ar = deps([card(1)]);
    await handleStoreSearch(req("?q=%D9%85%D8%AD%D8%B1%D9%83&locale=xx"), ar, "1.1.1.1");
    expect(ar.listing).toHaveBeenCalledWith("محرك", "en");
  });

  it("answers 503 (not cached) when the catalogue read fails", async () => {
    const d: StoreSearchDeps = { listing: async () => Promise.reject(new Error("down")), rate: okRate };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleStoreSearch(req("?q=motor"), d, "1.1.1.1");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 429 with Retry-After once the rate limit is reached", async () => {
    const rate = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const d = { ...deps([card(1)]), rate };
    expect((await handleStoreSearch(req("?q=motor"), d, "9.9.9.9")).status).toBe(200);
    expect((await handleStoreSearch(req("?q=motor"), d, "9.9.9.9")).status).toBe(200);
    const res = await handleStoreSearch(req("?q=motor"), d, "9.9.9.9");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another client is not affected.
    expect((await handleStoreSearch(req("?q=motor"), d, "8.8.8.8")).status).toBe(200);
  });
});

describe("rate limiter", () => {
  it("opens a new window after windowMs", () => {
    const r = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(r.hit("a", 0).allowed).toBe(true);
    expect(r.hit("a", 500)).toEqual({ allowed: false, retryAfterSec: 1 });
    expect(r.hit("a", 1000).allowed).toBe(true);
  });

  it("evicts old keys when full", () => {
    const r = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    r.hit("a", 0);
    r.hit("b", 0);
    expect(r.hit("c", 10).allowed).toBe(true);
  });

  it("reads the first forwarded IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "5.5.5.5, 10.0.0.1" }))).toBe("5.5.5.5");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
