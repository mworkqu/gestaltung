// Storefront category list (SITE_AUDIT #15): only categories that have at
// least one product a customer can actually open — published, and not a
// duplicate merged into another product (0030). Works on rows read before
// 0030 too (merged_into is then absent).

type CategoryRow = {
  category: string | null;
  is_published?: boolean | null;
  merged_into?: string | null;
};

/** Is this product listed on the storefront? */
export function isListed(p: Omit<CategoryRow, "category">): boolean {
  return p.is_published !== false && !p.merged_into;
}

/** Distinct, non-empty categories of listed products, sorted. */
export function listedCategories(rows: readonly CategoryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    // Kept verbatim: the store filters on exact equality with parts.category.
    if (r.category?.trim() && isListed(r)) set.add(r.category);
  }
  return Array.from(set).sort();
}
