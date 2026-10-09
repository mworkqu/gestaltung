// Cached, cookie-free catalogue reads for the public storefront (Phase G).
//
// Every function here uses the anon client (lib/supabase/public.ts: no
// cookies, no headers), so the pages calling them can be static / ISR, and is
// wrapped in unstable_cache with the "parts" tag (lib/cache/storefront.ts):
// the data is reused across renders and across visitors for up to 5 minutes,
// or until an admin write calls revalidateStorefront(). The search route is
// dynamic HTML, but its data still comes from here, keyed by the normalised
// query, so repeated searches do not hit the database.

import { unstable_cache } from "next/cache";

import type { Part } from "@/lib/supabase/types";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isListed, listedCategories } from "@/lib/store/categories";
import { isStoreCategory, storeCategoryOf } from "@/lib/store/store-categories";
import {
  leadClassesFor,
  searchFilter,
  STORE_CARD_COLUMNS,
  STORE_PAGE_SIZE,
  type StoreCardPart,
  type StoreState,
} from "@/lib/store/catalog";
import { sortProducts } from "@/lib/store/search";
import type { DeliveryQuote } from "@/lib/store/delivery";
import { CATALOG_TAG, SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { parseTrustedBy, TRUSTED_BY_KEY, type TrustedLogo } from "@/lib/trust";
import { PRICING_PLANS_KEY, SERVICE_PRICES_KEY, type PricingPlans, type ServicePrices } from "@/lib/pricing/defaults";
import { parsePricingPlans, parseServicePrices } from "@/lib/pricing/plans";
import { HOLIDAYS_KEY, parseHolidays, type Holidays } from "@/lib/store/working-days";
import { OCCASIONS_KEY, parseOccasions, type Occasion } from "@/lib/occasions";
import { parsePartSource, withoutPrivateFields, type PartSource } from "@/lib/store/part-source";
import { parseApprovedReviews, parseReviewCount, type ApprovedReview } from "@/lib/reviews/reviews";
import {
  inSkuOrder,
  mergeBoughtTogether,
  parseCoPurchased,
  rankInStockFirst,
  UPSELL_COUNT,
  type UpsellPick,
} from "@/lib/store/bought-together";

const CACHE = { revalidate: STOREFRONT_REVALIDATE, tags: [CATALOG_TAG] };

// A search ranks every matching row before paging; the catalogue is a few
// hundred to ~1,000 products, so this stays a handful of slim rows.
const MAX_SEARCH_ROWS = 3000;

/**
 * Does parts.store_category exist yet (C5, migration 0048)? Selecting a
 * missing column is an error in PostgREST, so every storefront read asks this
 * first (one tiny cached request per cache window) and names the column only
 * when it exists; before 0048 everything reads parts.category as before. Any
 * error counts as "not yet": the fallback is always safe.
 */
export const hasStoreCategory = unstable_cache(
  async (): Promise<boolean> => {
    const supabase = createPublicClient();
    if (!supabase) return false;
    const { error } = await supabase.from("parts").select("store_category").limit(1);
    return !error;
  },
  ["store:has-store-category"],
  CACHE,
);

/** Card columns, plus store_category once 0048 has run. */
const cardColumns = (store: boolean): string => (store ? `${STORE_CARD_COLUMNS}, store_category` : STORE_CARD_COLUMNS);

type CardRow = StoreCardPart & { store_category?: string | null };

/** Keep only the card's fields (a full row must never reach a client prop); category = the storefront one. */
function toCard(p: CardRow): StoreCardPart {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    name_ar: p.name_ar,
    unit_price: p.unit_price,
    image_url: p.image_url,
    category: storeCategoryOf(p) ?? p.category,
    min_order_qty: p.min_order_qty,
    lead_time_class: p.lead_time_class ?? null,
  };
}

type FacetRow = {
  category: string | null;
  store_category?: string | null;
  material: string | null;
  is_published: boolean;
  merged_into: string | null;
};

/** Every listed category and material (filter options, home quick-links). Paged past PostgREST's 1,000 cap. */
export const getStoreFacets = unstable_cache(
  async (): Promise<{ categories: string[]; materials: string[] }> => {
    const supabase = createPublicClient();
    if (!supabase) return { categories: [], materials: [] };
    const store = await hasStoreCategory();
    const { rows } = await fetchAllRows<FacetRow>((from, to) =>
      supabase
        .from("parts")
        .select(store ? "category, store_category, material, is_published, merged_into" : "category, material, is_published, merged_into")
        .eq("is_published", true)
        .not("lead_time_class", "is", null)
        .order("id")
        .range(from, to),
    );
    return {
      categories: listedCategories(rows),
      materials: Array.from(new Set(rows.filter(isListed).map((p) => p.material).filter((m): m is string => !!m))).sort(),
    };
  },
  ["store:facets"],
  CACHE,
);

/**
 * One page of the /store list for a parsed URL state. The key is the state
 * itself (parseStoreParams already normalised it) plus the locale (sorting by
 * name differs per locale).
 */
export const getStoreListing = unstable_cache(
  async (state: StoreState, locale: string): Promise<{ parts: StoreCardPart[]; total: number }> => {
    const supabase = createPublicClient();
    if (!supabase) return { parts: [], total: 0 };
    const store = await hasStoreCategory();
    const filter = searchFilter(state.q, { storeCategory: store });
    // ?category= is a store category once 0048 has run; an older source
    // category in a saved link (e.g. "Microcontrollers") still filters
    // parts.category, so the link keeps working.
    const categoryColumn = store && isStoreCategory(state.category) ? "store_category" : "category";
    const base = (withCount: boolean) => {
      let query = supabase
        .from("parts")
        .select(cardColumns(store), withCount ? { count: "exact" } : undefined)
        .eq("is_published", true)
        .is("merged_into", null)
        // Nothing without a delivery date is listed (owner, 2026-09-29); its
        // page still opens from an old link.
        .not("lead_time_class", "is", null);
      if (state.category) query = query.eq(categoryColumn, state.category);
      if (state.material) query = query.eq("material", state.material);
      if (state.stock) query = query.in("lead_time_class", leadClassesFor(state.stock));
      if (filter) query = query.or(filter);
      return query;
    };
    const from = (state.page - 1) * STORE_PAGE_SIZE;
    if (filter) {
      // Search: every matching slim row, ranked / sorted here, then one page.
      const { rows } = await fetchAllRows<CardRow>((a, b) => base(false).order("id").range(a, b), 1000, MAX_SEARCH_ROWS);
      // Rank on the storefront category (its weight), not the source one.
      const sorted = sortProducts(rows.map(toCard), state.sort, state.q, locale);
      return { parts: sorted.slice(from, from + STORE_PAGE_SIZE), total: sorted.length };
    }
    // Browse: sorted and paged in the database.
    let query = base(true);
    if (state.sort === "price_asc" || state.sort === "price_desc") {
      query = query.order("unit_price", { ascending: state.sort === "price_asc" });
    }
    if (locale === "ar") query = query.order("name_ar", { ascending: true, nullsFirst: false });
    query = query.order("name", { ascending: true }).order("id", { ascending: true });
    const { data, count } = await query.range(from, from + STORE_PAGE_SIZE - 1);
    const parts = ((data ?? []) as unknown as CardRow[]).map(toCard);
    return { parts, total: count ?? parts.length };
  },
  ["store:listing"],
  CACHE,
);

/**
 * The homepage's featured row: in-stock products with a photo, one per
 * category first so the row shows the range (owner, 2026-09-29), then the
 * newest of the rest; eight in all. Card fields only.
 */
export const getFeaturedParts = unstable_cache(
  async (): Promise<StoreCardPart[]> => {
    const supabase = createPublicClient();
    if (!supabase) return [];
    const store = await hasStoreCategory();
    const { data } = await supabase
      .from("parts")
      .select(`${cardColumns(store)}, is_published, merged_into`)
      .eq("is_published", true)
      .eq("lead_time_class", "in_stock")
      .not("image_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    const pool = ((data ?? []) as unknown as (CardRow & { is_published: boolean; merged_into: string | null })[])
      .filter(isListed)
      .map(toCard);
    const byCategory = new Map<string, StoreCardPart>();
    for (const p of pool) if (!byCategory.has(p.category ?? "")) byCategory.set(p.category ?? "", p);
    const firsts = new Set(byCategory.values());
    return [...firsts, ...pool.filter((p) => !firsts.has(p))].slice(0, 8);
  },
  ["store:featured"],
  CACHE,
);

/** A published product by SKU (the product page needs description/specs; private sourcing fields dropped), or null. */
export const getPublishedPart = unstable_cache(
  async (sku: string): Promise<Part | null> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    // select("*"): specs_ar (0047) may not exist yet, so no named columns here.
    const { data } = await supabase.from("parts").select("*").eq("sku", sku).eq("is_published", true).maybeSingle();
    // Cost / income / sourcing internals never enter the cached public row (P2-07).
    return data ? withoutPrivateFields(data as Part) : null;
  },
  ["store:part"],
  CACHE,
);

/** The SKU an old, merged product now lives under (0030), or null. */
export const getMergedRedirectSku = unstable_cache(
  async (sku: string): Promise<string | null> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data } = await supabase.rpc("part_merged_redirect_sku", { p_sku: sku });
    return typeof data === "string" && data && data !== sku ? data : null;
  },
  ["store:merged-redirect"],
  CACHE,
);

/**
 * order_delivery_quote for one product (the same computation checkout
 * records). Dates move daily; the 5-minute lifetime and both tags (offers move
 * the lead time, settings move tier days and prices) keep it current.
 */
export const getProductDeliveryQuote = unstable_cache(
  async (partId: string, quantity: number): Promise<DeliveryQuote | null> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data } = await supabase.rpc("order_delivery_quote", { p_items: [{ part_id: partId, quantity }] });
    return (data ?? null) as DeliveryQuote | null;
  },
  ["store:delivery-quote"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [CATALOG_TAG, SETTINGS_TAG] },
);

/**
 * store_settings.trusted_by → the "Trusted by" logos (P1-04). Same cookie-free
 * anon client + unstable_cache + "store-settings" tag as the other settings
 * reads, so the site-wide trust block (rendered in the locale layout) keeps
 * static / ISR pages static. Empty when the key is missing, malformed or [].
 */
export const getTrustedBy = unstable_cache(
  async (): Promise<TrustedLogo[]> => {
    const supabase = createPublicClient();
    if (!supabase) return [];
    const { data } = await supabase.from("store_settings").select("value").eq("key", TRUSTED_BY_KEY).maybeSingle();
    return parseTrustedBy(data?.value);
  },
  ["store-settings:trusted-by"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

/** Plans for /pricing (P1-06): store_settings.pricing_plans (0051), else the identical defaults. */
export const getPricingPlans = unstable_cache(
  async (): Promise<PricingPlans> => {
    const supabase = createPublicClient();
    if (!supabase) return parsePricingPlans(null);
    const { data } = await supabase.from("store_settings").select("value").eq("key", PRICING_PLANS_KEY).maybeSingle();
    return parsePricingPlans(data?.value);
  },
  ["store-settings:pricing-plans"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

/** "Services, from" prices (P1-07): store_settings.service_prices (0051), else the identical defaults. */
export const getServicePrices = unstable_cache(
  async (): Promise<ServicePrices> => {
    const supabase = createPublicClient();
    if (!supabase) return parseServicePrices(null);
    const { data } = await supabase.from("store_settings").select("value").eq("key", SERVICE_PRICES_KEY).maybeSingle();
    return parseServicePrices(data?.value);
  },
  ["store-settings:service-prices"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

/**
 * store_settings.holidays (P2-06, 0054): the weekend + public holidays that
 * every promise date skips. null when the row does not exist (0054 not run):
 * callers then keep calendar days, exactly like the database before 0054.
 */
export const getHolidays = unstable_cache(
  async (): Promise<Holidays | null> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data, error } = await supabase.from("store_settings").select("value").eq("key", HOLIDAYS_KEY).maybeSingle();
    if (error || !data) return null;
    return parseHolidays(data.value);
  },
  ["store-settings:holidays"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

/**
 * store_settings.occasions (P3-07, 0056): the seasonal campaigns, validated
 * (invalid entries dropped). Empty when the row is missing or malformed. Same
 * cookie-free anon client + "store-settings" tag as the other settings reads,
 * so the pages showing the banner stay static / ISR. Which one is ON today is
 * decided by the caller (activeOccasions + qatarToday) at render time.
 */
export const getOccasions = unstable_cache(
  async (): Promise<Occasion[]> => {
    const supabase = createPublicClient();
    if (!supabase) return [];
    const { data } = await supabase.from("store_settings").select("value").eq("key", OCCASIONS_KEY).maybeSingle();
    return parseOccasions(data?.value);
  },
  ["store-settings:occasions"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

/**
 * An occasion's explicit product list (P3-07): listed products (published,
 * unmerged, with a delivery date) for these SKUs, in the given order, card
 * fields only. A SKU that is missing or unpublished is simply skipped.
 */
export const getCardsBySkus = unstable_cache(
  async (skus: string[]): Promise<StoreCardPart[]> => {
    const supabase = createPublicClient();
    if (!supabase || skus.length === 0) return [];
    const store = await hasStoreCategory();
    const { data } = await supabase
      .from("parts")
      .select(cardColumns(store))
      .in("sku", skus)
      .eq("is_published", true)
      .is("merged_into", null)
      .not("lead_time_class", "is", null);
    return inSkuOrder(((data ?? []) as unknown as CardRow[]).map(toCard), skus);
  },
  ["store:cards-by-sku"],
  CACHE,
);

/**
 * Where a product comes from, for the product page's "Source" line (P2-07):
 * part_public_source() (0054, SECURITY DEFINER) returns ONLY the preferred
 * offer's supplier code, the lead class and the backup product's sku /
 * supplier code / lead class — never a cost, landed cost, income or margin
 * (suppliers and supplier_offers stay admin-only). null before 0054 runs or
 * when the product is not published. Same tags as the product read: offer and
 * supplier writes call revalidateStorefront().
 */
export const getPartSource = unstable_cache(
  async (partId: string): Promise<PartSource | null> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("part_public_source", { p_part: partId });
    if (error) return null;
    return parsePartSource(data);
  },
  ["store:part-source"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [CATALOG_TAG, SETTINGS_TAG] },
);

// ── Upsell (P3-06 / WF-34) ──────────────────────────────────────────────────

// Enough candidates per category set that a BOM's own SKUs can be left out
// and three still remain.
const UPSELL_POOL = 36;

const upsellPool = unstable_cache(
  async (categories: string[]): Promise<StoreCardPart[]> => {
    const supabase = createPublicClient();
    if (!supabase || !categories.length) return [];
    const store = await hasStoreCategory();
    const column = store ? "store_category" : "category";
    // Two small reads instead of one sorted one: the lead class is text, so
    // "in stock first" cannot be an ORDER BY. Newest first inside each.
    const base = () =>
      supabase
        .from("parts")
        .select(cardColumns(store))
        .eq("is_published", true)
        .is("merged_into", null)
        .in(column, categories)
        .order("updated_at", { ascending: false })
        .limit(UPSELL_POOL);
    const [inStock, later] = await Promise.all([
      base().eq("lead_time_class", "in_stock"),
      base().not("lead_time_class", "is", null).neq("lead_time_class", "in_stock"),
    ]);
    const rows = [...((inStock.data ?? []) as unknown as CardRow[]), ...((later.data ?? []) as unknown as CardRow[])];
    return rankInStockFirst(rows.map(toCard)).slice(0, UPSELL_POOL);
  },
  ["store:upsell-pool"],
  CACHE,
);

/**
 * Listed products (published, unmerged, with a delivery date) in these store
 * categories, in stock first, card fields only. The key is the sorted set, so
 * the same categories in another order hit the same cache entry. Used by the
 * product page's fallback and the BOM's "Also useful" (/api/bom/match).
 */
export function getUpsellPool(categories: readonly string[]): Promise<StoreCardPart[]> {
  const set = [...new Set(categories.map((c) => c.trim()).filter(Boolean))].sort().slice(0, 9);
  return set.length ? upsellPool(set) : Promise.resolve([]);
}

/**
 * The product page's "Frequently bought together" (P3-06). co_purchased()
 * (migration 0057, SECURITY DEFINER, anon) ranks the SKUs bought in the same
 * orders — it returns only SKU + order count; the cards are read here from the
 * public catalogue. Until 0057 runs the call errors (PGRST202) and the list is
 * same-category products; fewer than three co-purchased products are topped
 * up the same way. `source` says which, so the heading stays honest.
 */
export const getFrequentlyBoughtTogether = unstable_cache(
  async (sku: string, storeCategory: string | null): Promise<UpsellPick> => {
    const supabase = createPublicClient();
    if (!supabase) return { parts: [], source: "category" };
    let together: StoreCardPart[] = [];
    const { data, error } = await supabase.rpc("co_purchased", { p_sku: sku, p_limit: UPSELL_COUNT });
    if (error && error.code !== "PGRST202") console.warn(`[store] co_purchased failed: ${error.message}`);
    const ranked = error ? [] : parseCoPurchased(data);
    if (ranked.length) {
      const store = await hasStoreCategory();
      const { data: rows } = await supabase
        .from("parts")
        .select(cardColumns(store))
        .in("sku", ranked)
        .eq("is_published", true)
        .is("merged_into", null)
        .not("lead_time_class", "is", null);
      together = inSkuOrder(((rows ?? []) as unknown as CardRow[]).map(toCard), ranked);
    }
    const fallback = together.length >= UPSELL_COUNT || !storeCategory ? [] : await getUpsellPool([storeCategory]);
    return mergeBoughtTogether({ together, fallback, currentSku: sku });
  },
  ["store:bought-together"],
  CACHE,
);

// Approved customer reviews (P4-03, migration 0058). approved_reviews() and
// approved_review_count() are anon-callable and return only approved rows with
// the first name — never an order id, email or surname. Before 0058 runs the
// calls fail with PGRST202: everything below answers "no reviews" silently, so
// the sections that use it render nothing. Any other error is warned once.
export const REVIEWS_PER_SECTION = 6;
let reviewsWarned = false;
function reviewsFailed(what: string, error: { code?: string; message: string }): void {
  if (error.code === "PGRST202" || error.code === "42P01" || error.code === "42883") return;
  if (reviewsWarned) return;
  reviewsWarned = true;
  console.warn(`[store] ${what} failed: ${error.message}`);
}

/** Up to six approved reviews from orders that contained this SKU, newest first. */
export const getApprovedReviewsForSku = unstable_cache(
  async (sku: string): Promise<ApprovedReview[]> => {
    const supabase = createPublicClient();
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("approved_reviews", { p_sku: sku, p_limit: REVIEWS_PER_SECTION });
    if (error) {
      reviewsFailed("approved_reviews", error);
      return [];
    }
    return parseApprovedReviews(data);
  },
  ["store:reviews-by-sku"],
  CACHE,
);

/** The home strip: how many approved reviews exist, plus the newest six. */
export const getHomeReviews = unstable_cache(
  async (): Promise<{ count: number; reviews: ApprovedReview[] }> => {
    const supabase = createPublicClient();
    if (!supabase) return { count: 0, reviews: [] };
    const counted = await supabase.rpc("approved_review_count");
    if (counted.error) {
      reviewsFailed("approved_review_count", counted.error);
      return { count: 0, reviews: [] };
    }
    const count = parseReviewCount(counted.data);
    if (count === 0) return { count, reviews: [] };
    const { data, error } = await supabase.rpc("approved_reviews", { p_limit: REVIEWS_PER_SECTION });
    if (error) {
      reviewsFailed("approved_reviews", error);
      return { count: 0, reviews: [] };
    }
    return { count, reviews: parseApprovedReviews(data) };
  },
  ["store:home-reviews"],
  CACHE,
);
