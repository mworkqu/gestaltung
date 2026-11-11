// Which storefront cache tags a supplier sync must purge (consolidation 2.2).
// Pure: no next/*, no Supabase. lib/cache/storefront.ts applies the result.
//
// Three levels (see lib/cache/storefront.ts for where each tag is attached):
//   "part-<sku>"     one product's own reads -> its two pages (en + ar) plus any
//                    product page that shows it as a "bought together" card
//   "parts-listing"  the listing-level reads (store listing, facets, home
//                    featured row, collections, upsell pool) -> a few dozen pages
//   "parts"          every catalogue read, product pages included -> ~2,600 pages
//
// A sync run purges "part-<sku>" for every product whose offer it changed, plus
// "parts-listing" only when a field a listing shows or filters on moved, and
// falls back to one "parts" purge when more than CRON_SKU_TAG_CAP products moved.

/** The parts columns a snapshot needs. Listing fields = what the card query selects or filters on. */
export const PART_SNAPSHOT_COLUMNS =
  "id, sku, backup_for, is_published, merged_into, name, name_ar, unit_price, image_url, category, store_category, material, lead_time_class, min_order_qty";

export type PartSnapshot = {
  id: string;
  sku: string;
  backup_for?: string | null;
  is_published?: boolean | null;
  merged_into?: string | null;
  name?: string | null;
  name_ar?: string | null;
  unit_price?: number | string | null;
  image_url?: string | null;
  category?: string | null;
  store_category?: string | null;
  material?: string | null;
  lead_time_class?: string | null;
  min_order_qty?: number | null;
};

/**
 * Fields that decide whether / where / how a product shows in a listing:
 * STORE_CARD_COLUMNS (lib/store/catalog.ts: name, name_ar, unit_price,
 * image_url, category, lead_time_class, min_order_qty) + store_category (the
 * card's category once 0048 ran), the listing WHERE clauses (is_published,
 * merged_into, lead_time_class not null, category / store_category, material)
 * and the featured row's "has a photo" filter (image_url). updated_at is left
 * out on purpose: it only orders the featured row / upsell pool ("newest"),
 * and an order that lags by up to 24 h is not a stale price.
 */
export const LISTING_FIELDS = [
  "is_published",
  "merged_into",
  "name",
  "name_ar",
  "unit_price",
  "image_url",
  "category",
  "store_category",
  "material",
  "lead_time_class",
  "min_order_qty",
] as const satisfies readonly (keyof PartSnapshot)[];

/**
 * More changed products than this in one run -> one full "parts" purge instead
 * of per-SKU tags. 100 is ~8 % of the ~1,300 published products: a run that
 * moves more is a catalogue-wide repricing (Voltaat changing everything, an FX
 * move), where per-SKU purges would re-render most crawled product pages
 * anyway (each SKU also re-renders the product pages that show it as a card)
 * and one tag is one cache call instead of hundreds. Below it, a per-SKU purge
 * is always a subset of the full one, so it never costs more ISR writes.
 */
export const CRON_SKU_TAG_CAP = 100;

export const CATALOG_TAG = "parts";
export const LISTING_TAG = "parts-listing";
/** The tag carried by one product's cached reads, and so by its own two pages. */
export const partTag = (sku: string): string => `part-${sku}`;

export type CatalogChange = {
  /** SKUs whose own pages must refresh. */
  skus: string[];
  /** True when a listing-level read can show something different. */
  listingChanged: boolean;
  /** A touched product could not be read at all (unknown SKU): purge everything. */
  unknown?: boolean;
};

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  // numeric columns can come back as "12.50" or 12.5
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
};

function listingDiffers(before: PartSnapshot | undefined, after: PartSnapshot | undefined): boolean {
  if (!before || !after) return before !== after; // appeared or disappeared
  return LISTING_FIELDS.some((f) => !same(before[f], after[f]));
}

/**
 * What a sync run changed, from the parts rows before and after its writes.
 * `touchedIds` = the products whose supplier offer the run actually changed or
 * dropped (an offer that moved can change the product page's delivery date or
 * source line without touching a parts column, so each one gets its tag).
 * A touched product that is the backup of another (backup_for) also refreshes
 * that other product: its page shows the backup's lead class.
 */
export function diffPartSnapshots(touchedIds: readonly string[], before: readonly PartSnapshot[], after: readonly PartSnapshot[]): CatalogChange {
  const b = new Map(before.map((p) => [p.id, p]));
  const a = new Map(after.map((p) => [p.id, p]));
  const skuOf = (id: string): string | undefined => a.get(id)?.sku ?? b.get(id)?.sku;
  const skus = new Set<string>();
  let listingChanged = false;
  let unknown = false;
  for (const id of new Set(touchedIds)) {
    const sku = skuOf(id);
    if (sku) skus.add(sku);
    else unknown = true;
    if (listingDiffers(b.get(id), a.get(id))) listingChanged = true;
    const main = a.get(id)?.backup_for ?? b.get(id)?.backup_for;
    const mainSku = main ? skuOf(main) : undefined;
    if (mainSku) skus.add(mainSku);
  }
  return unknown ? { skus: [...skus].sort(), listingChanged: true, unknown } : { skus: [...skus].sort(), listingChanged };
}

/** The tags to purge for a change (empty = nothing to do). */
export function catalogTagsFor(change: CatalogChange, cap: number = CRON_SKU_TAG_CAP): string[] {
  if (change.unknown || change.skus.length > cap) return [CATALOG_TAG];
  const tags = change.skus.map(partTag);
  if (change.listingChanged) tags.unshift(LISTING_TAG);
  return tags;
}
