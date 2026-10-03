// Storefront category list (SITE_AUDIT #15): only categories that have at
// least one product a customer can actually open — published, and not a
// duplicate merged into another product (0030). Works on rows read before
// 0030 too (merged_into is then absent).
//
// C5 (0048): the store shows parts.store_category; rows read before 0048 (no
// store_category) fall back to parts.category (storeCategoryOf).

import { STORE_CATEGORIES, storeCategoryOf } from "@/lib/store/store-categories";

type CategoryRow = {
  category: string | null;
  store_category?: string | null;
  is_published?: boolean | null;
  merged_into?: string | null;
};

/** Is this product listed on the storefront? */
export function isListed(p: Omit<CategoryRow, "category">): boolean {
  return p.is_published !== false && !p.merged_into;
}

const ORDER = new Map<string, number>(STORE_CATEGORIES.map((c, i) => [c, i]));

/**
 * Distinct, non-empty storefront categories of listed products. The nine
 * store categories come in the owner's order; anything else (rows read before
 * 0048) follows alphabetically.
 */
export function listedCategories(rows: readonly CategoryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    // Kept verbatim: the store filters on exact equality with the stored value.
    const c = storeCategoryOf(r);
    if (c?.trim() && isListed(r)) set.add(c);
  }
  return Array.from(set).sort((a, b) => {
    const ia = ORDER.get(a) ?? Infinity;
    const ib = ORDER.get(b) ?? Infinity;
    return ia !== ib ? ia - ib : a < b ? -1 : a > b ? 1 : 0;
  });
}
