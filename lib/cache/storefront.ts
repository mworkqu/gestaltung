// Storefront caching model (Phase G).
//
// Public pages (home, /store, product pages, marketing + legal pages) are
// static / ISR: rendered once per locale, served from the CDN, re-rendered in
// the background at most every STOREFRONT_REVALIDATE seconds. Their catalogue
// reads go through unstable_cache (lib/store/public-catalog.ts) tagged with
// the tags below, so an admin edit can refresh them at once instead of waiting
// for the expiry:
//   "parts"           every published-product read (list, facets, product
//                     page, featured row, delivery quote): the full purge
//   "parts-listing"   the listing-level reads only (store listing, facets, home
//                     featured row, collections, upsell pool, review strip), on
//                     top of "parts": a few dozen pages, never a product page
//   "store-settings"  store_settings reads (shipping tiers -> "Arrives by")
//   "part-<sku>"      the reads of ONE product, on top of "parts" (also the
//                     "bought together" cards that show it on other products)
//   "contact-phone"   the contact number in the footer, on top of "store-settings"
// Call revalidateStorefront() after any write to parts, supplier_offers,
// suppliers or store_settings (admin actions, admin API routes). The two
// supplier crons purge per product instead: revalidateCatalogChange() with
// the decision from lib/cache/catalog-tags.ts ("part-<sku>" per moved
// product, "parts-listing" only when a listed field moved, "parts" past the cap).
// The two narrow tags exist because the broad purge is expensive: ~1,300
// products x 2 locales of cached pages all re-render, and every re-render is
// an ISR write. Use revalidatePart() / revalidateContactPhone() only where the
// write provably cannot change a listing, a facet or another product's page —
// a stale page costs the owner more than a write.
//
// Expiry is 24 h (2026-10-16): the 5-minute window rewrote every visited page
// and its 5-6 cache entries ~288 times a day and blew the Vercel Hobby ISR-write
// allowance (200k/month). Data only changes through writes that purge the tags,
// and the 24 h expiry itself re-renders a visited page's "Arrives by" dates
// once a day. Search results with a query are not cached at all (unbounded key
// space from bots).

import { revalidateTag } from "next/cache";

import { CATALOG_TAG, catalogTagsFor, partTag, type CatalogChange } from "@/lib/cache/catalog-tags";

export { CATALOG_TAG, LISTING_TAG, partTag } from "@/lib/cache/catalog-tags";
export const SETTINGS_TAG = "store-settings";
export const CONTACT_PHONE_TAG = "contact-phone";

/** Seconds (24 h). Pages repeat this as a literal `export const revalidate = 86400` (Next needs a literal). */
export const STOREFRONT_REVALIDATE = 86400;

function purge(...tags: string[]): void {
  try {
    for (const tag of tags) revalidateTag(tag);
  } catch (e) {
    // Outside a request (a script, a test) there is no cache to invalidate.
    console.warn("[storefront] revalidate skipped:", e instanceof Error ? e.message : e);
  }
}

/** Mark every cached storefront read stale; the next visit re-renders the page. */
export function revalidateStorefront(): void {
  purge(CATALOG_TAG, SETTINGS_TAG);
}

/**
 * After a supplier sync: purge only what the run changed (catalogTagsFor:
 * per-SKU tags, the listing tag when a listed field moved, or one full
 * "parts" purge past the cap). Returns the tags purged, for the cron reply.
 */
export function revalidateCatalogChange(change: CatalogChange): string[] {
  const tags = catalogTagsFor(change);
  if (tags.length) purge(...tags);
  return tags;
}

/**
 * Purge a list of tags that was already decided elsewhere: the cron jobs
 * (lib/cron/jobs.ts) and POST /api/internal/revalidate, which the Mac Mini
 * worker calls because it cannot reach revalidateTag. Returns the tags.
 */
export function revalidateTags(tags: readonly string[]): string[] {
  if (tags.length) purge(...tags);
  return [...tags];
}

/**
 * Mark one product's cached reads stale: only its own two pages (en + ar)
 * re-render, instead of the whole catalogue. For an edit that cannot show up
 * on a card, in a facet, in search or on another product — a product's specs,
 * its pack size. Anything that moves a name, a price, a photo, a category, a
 * material, the minimum quantity or the published flag belongs in
 * revalidateStorefront(), because the listings carry those too.
 */
export function revalidatePart(sku: string): void {
  if (!sku) return revalidateStorefront();
  purge(partTag(sku));
}

/**
 * Mark the footer's contact number stale (lib/contact-phone-server.ts). It is
 * read on every page, so every page does re-render — but the catalogue reads
 * themselves are left alone, and nothing outside the number is touched.
 */
export function revalidateContactPhone(): void {
  purge(CONTACT_PHONE_TAG);
}
