// Storefront caching model (Phase G).
//
// Public pages (home, /store, product pages, marketing + legal pages) are
// static / ISR: rendered once per locale, served from the CDN, re-rendered in
// the background at most every STOREFRONT_REVALIDATE seconds. Their catalogue
// reads go through unstable_cache (lib/store/public-catalog.ts) tagged with
// the tags below, so an admin edit can refresh them at once instead of waiting
// for the 5 minutes:
//   "parts"           every published-product read (list, facets, product
//                     page, featured row, delivery quote)
//   "store-settings"  store_settings reads (shipping tiers -> "Arrives by")
// Call revalidateStorefront() after any write to parts, supplier_offers,
// suppliers or store_settings (admin actions, admin API routes, the cron syncs).

import { revalidateTag } from "next/cache";

export const CATALOG_TAG = "parts";
export const SETTINGS_TAG = "store-settings";

/** Seconds. Pages repeat this as a literal `export const revalidate = 300` (Next needs a literal). */
export const STOREFRONT_REVALIDATE = 300;

/** Mark every cached storefront read stale; the next visit re-renders the page. */
export function revalidateStorefront(): void {
  try {
    revalidateTag(CATALOG_TAG);
    revalidateTag(SETTINGS_TAG);
  } catch (e) {
    // Outside a request (a script, a test) there is no cache to invalidate.
    console.warn("[storefront] revalidate skipped:", e instanceof Error ? e.message : e);
  }
}
