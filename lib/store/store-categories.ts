// Storefront categories (C5, owner decision 2026-10-04): the store shows NINE
// categories. They live in parts.store_category (migration 0048); the
// supplier/source category stays in parts.category, which the Voltaat import,
// the price syncs and the BOM matcher keep using.
//
// How a product gets its store category:
//   1. its own parts.store_category (set per SKU by 0048, or by the owner in
//      the product form) — the override;
//   2. otherwise the DB trigger copies the wholesale default for its source
//      category from store_category_rules (seeded from SOURCE_CATEGORY_DEFAULTS
//      below, same values);
//   3. a source category with no rule gets FALLBACK_STORE_CATEGORY and
//      store_category_review = true, so the admin catalog lists it for review.
//
// No imports on purpose: scripts/build-category-migration.mjs loads this file
// directly with Node's type stripping to generate 0048.

export const STORE_CATEGORIES = [
  "Boards and microcontrollers",
  "Sensors",
  "Modules",
  "Chips and ICs",
  "Power",
  "Motors and mechanical",
  "Cables and connectors",
  "Tools and accessories",
  "3D printing",
] as const;

export type StoreCategory = (typeof STORE_CATEGORIES)[number];

export const FALLBACK_STORE_CATEGORY: StoreCategory = "Tools and accessories";

/**
 * Wholesale default per source category (parts.category) for products that
 * arrive after 0048. Mirrors the store_category_rules seed in 0048 (a test
 * checks). "Other" is deliberately absent: those products need a look.
 */
export const SOURCE_CATEGORY_DEFAULTS: Readonly<Record<string, StoreCategory>> = {
  Microcontrollers: "Boards and microcontrollers",
  "Raspberry Pi": "Boards and microcontrollers",
  Kits: "Boards and microcontrollers",
  Sensors: "Sensors",
  Modules: "Modules",
  Displays: "Modules",
  "Chips & ICs": "Chips and ICs",
  Components: "Chips and ICs",
  Power: "Power",
  Motors: "Motors and mechanical",
  Mechanical: "Motors and mechanical",
  Fasteners: "Motors and mechanical",
  Prototyping: "Cables and connectors",
  Tools: "Tools and accessories",
  "3D printers": "3D printing",
  "3D printing filament": "3D printing",
  "3D printer parts": "3D printing",
};

export function isStoreCategory(value: string | null | undefined): value is StoreCategory {
  return !!value && (STORE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * What the DB trigger does for a new product without its own store category:
 * the rule for its source category, else the fallback flagged for review.
 */
export function storeCategoryForSource(source: string | null | undefined): { category: StoreCategory; review: boolean } {
  const rule = source ? SOURCE_CATEGORY_DEFAULTS[source.trim()] : undefined;
  return rule ? { category: rule, review: false } : { category: FALLBACK_STORE_CATEGORY, review: true };
}

/**
 * The category the storefront shows for a row: store_category when 0048 has
 * run and filled it, else the source category (rows read before 0048).
 */
export function storeCategoryOf(row: { category?: string | null; store_category?: string | null }): string | null {
  return row.store_category?.trim() ? row.store_category : row.category ?? null;
}
