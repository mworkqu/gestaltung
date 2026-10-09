// Upsell selection (P3-06 / WF-34). Pure, so the product page's "Frequently
// bought together" and the BOM's "Also useful" share one reading and it can be
// unit-tested. Every input and output is a StoreCardPart (lib/store/catalog.ts):
// card fields only — never a cost, landed cost, income or margin.
//
// Product page: co_purchased() (migration 0057) gives SKUs ranked by how many
// orders bought them with this product. Before 0057 runs, or with fewer than
// UPSELL_COUNT of them, the list is topped up with same-category products, in
// stock first. The heading is honest: "Frequently bought together" only when
// EVERY product shown came from real orders, else "You may also need".
//
// BOM: products from the same store categories as the BOM's resolved lines,
// minus anything already on the BOM, in stock first.

import type { StoreCardPart } from "@/lib/store/catalog";
import { LEAD_CLASS_DAYS } from "@/lib/store/delivery";

export const UPSELL_COUNT = 3;

/** Where the shown list came from: real orders, or same-category products. */
export type UpsellSource = "together" | "category";

export type UpsellPick = { parts: StoreCardPart[]; source: UpsellSource };

const leadRank = (p: Pick<StoreCardPart, "lead_time_class">): number =>
  p.lead_time_class ? (LEAD_CLASS_DAYS[p.lead_time_class] ?? 99) : 1000;

/**
 * In stock first, then the shorter delivery class, then with a photo; ties
 * keep their incoming order (stable), so a caller's own order (newest first)
 * survives inside a class.
 */
export function rankInStockFirst<T extends Pick<StoreCardPart, "lead_time_class" | "image_url">>(parts: readonly T[]): T[] {
  return parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => leadRank(a.p) - leadRank(b.p) || Number(!a.p.image_url) - Number(!b.p.image_url) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * The SKUs co_purchased() returned, in its order. Anything malformed (the
 * function missing before 0057, an error body, junk rows) reads as none.
 */
export function parseCoPurchased(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const { sku, orders } = row as { sku?: unknown; orders?: unknown };
    if (typeof sku !== "string" || !sku.trim()) continue;
    if (typeof orders === "number" && !(orders > 0)) continue;
    if (!out.includes(sku)) out.push(sku);
  }
  return out;
}

/** Rows loaded with `sku in (...)` back in the ranked SKU order; SKUs without a row are dropped. */
export function inSkuOrder<T extends Pick<StoreCardPart, "sku">>(rows: readonly T[], skus: readonly string[]): T[] {
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  return skus.map((s) => bySku.get(s)).filter((r): r is T => !!r);
}

/**
 * The product page's list: co-purchased first (their order kept), then
 * same-category products ranked in stock first, never the current SKU and
 * never twice; at most `limit`.
 */
export function mergeBoughtTogether({
  together,
  fallback,
  currentSku,
  limit = UPSELL_COUNT,
}: {
  together: readonly StoreCardPart[];
  fallback: readonly StoreCardPart[];
  currentSku: string;
  limit?: number;
}): UpsellPick {
  const seen = new Set<string>([currentSku]);
  const fromOrders: StoreCardPart[] = [];
  for (const p of together) {
    if (fromOrders.length >= limit) break;
    if (seen.has(p.sku)) continue;
    seen.add(p.sku);
    fromOrders.push(p);
  }
  const fill = pickAlsoUseful({ pool: fallback, excludeSkus: seen, limit: Math.max(0, limit - fromOrders.length) });
  const parts = [...fromOrders, ...fill];
  return { parts, source: fromOrders.length > 0 && fill.length === 0 ? "together" : "category" };
}

/** The distinct, non-empty store categories of the given products, first-seen order. */
export function categoriesOf(products: readonly ({ category?: string | null } | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of products) {
    const c = p?.category?.trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** "Also useful" under the BOM: the pool minus the BOM's SKUs, in stock first, at most `limit`. */
export function pickAlsoUseful({
  pool,
  excludeSkus,
  limit = UPSELL_COUNT,
}: {
  pool: readonly StoreCardPart[];
  excludeSkus: Iterable<string>;
  limit?: number;
}): StoreCardPart[] {
  const seen = new Set(excludeSkus);
  const kept = pool.filter((p) => {
    if (seen.has(p.sku)) return false;
    seen.add(p.sku);
    return true;
  });
  return rankInStockFirst(kept).slice(0, limit);
}
