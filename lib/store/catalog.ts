// The /store list's URL contract and card data contract (Phase C). Pure, so
// the server page and the client filter bar share one reading of the URL and
// it can be unit-tested. The URL is the single source of truth:
//   ?q=        search text (all words must match somewhere)
//   ?category= exact storefront category: parts.store_category (0048), or
//              parts.category before 0048 / for an older source-category link
//              (from data, never hard-coded)
//   ?material= exact parts.material value
//   ?stock=    delivery-time option (LEAD_FILTER_OPTIONS); the param keeps its
//              old name so shared links survive; unknown values are ignored
//   ?sort=     relevance | price_asc | price_desc | name (omitted = default)
//   ?page=     1-based, omitted on page 1
// Changing q, sort or any filter drops ?page.

import type { Part } from "@/lib/supabase/types";
import { LEAD_TIME_CLASSES, type LeadTimeClass } from "@/lib/store/sourcing";
import { arrivesByDate, LEAD_CLASS_DAYS, todayIso, type ShippingSettings } from "@/lib/store/delivery";
import { DAY_MS } from "@/lib/format/date";
import { categoriesForArabicTerm } from "@/lib/store/category-label";
import type { ProductSort } from "@/lib/store/search";

// ── Card data contract ───────────────────────────────────────────────────────

/**
 * Everything a store product card may read — and all the list page sends.
 * No description, specs or sourcing fields. `sku` builds the /store/<sku> URL
 * (it may be hidden on the card but stays in the link). `lead_time_class` is
 * also the stock flag: null = "available on request". Part satisfies this
 * type, so callers holding a full row (the homepage) can pass it unchanged.
 * `category` on a card is the STOREFRONT category: lib/store/public-catalog.ts
 * fills it from parts.store_category (0048), else parts.category.
 */
export type StoreCardPart = Pick<
  Part,
  "id" | "sku" | "name" | "name_ar" | "unit_price" | "image_url" | "category" | "min_order_qty"
> & {
  lead_time_class?: LeadTimeClass | null;
};

/** The select list matching StoreCardPart. Keep the two in step. */
export const STORE_CARD_COLUMNS =
  "id, sku, name, name_ar, unit_price, image_url, category, lead_time_class, min_order_qty";

export const STORE_PAGE_SIZE = 48;

// ── Sort ─────────────────────────────────────────────────────────────────────

export const STORE_SORTS = ["relevance", "price_asc", "price_desc", "name"] as const satisfies readonly ProductSort[];
export type StoreSort = (typeof STORE_SORTS)[number];

export const defaultSort = (hasQuery: boolean): StoreSort => (hasQuery ? "relevance" : "name");

/** A valid sort for this state; relevance needs a query, anything unknown = the default. */
export function resolveSort(raw: string | null | undefined, hasQuery: boolean): StoreSort {
  if (raw && (STORE_SORTS as readonly string[]).includes(raw)) {
    if (raw === "relevance" && !hasQuery) return "name";
    return raw as StoreSort;
  }
  return defaultSort(hasQuery);
}

/** The sorts offered in the select (relevance only while searching). */
export const sortOptions = (hasQuery: boolean): StoreSort[] =>
  STORE_SORTS.filter((s) => s !== "relevance" || hasQuery);

// ── Delivery-time filter ─────────────────────────────────────────────────────
// Options are delivery ranges in days from today. A product matches when the
// date its card shows ("Arrives by", arrivesByDate: supplier lead + handling +
// transit + buffer in Qatar working days) falls inside the range — NOT when its
// supplier lead class does, which ignored our own days and contradicted the
// card (F-013). That date depends only on the lead class, today and the
// shipping settings, so the filter still resolves to a set of lead_time_class
// values the database can match: no page is filtered after paging.
// Ranges are (previous option's max, own max]; the first starts at today.

export const LEAD_FILTER_OPTIONS = ["3_5_days", "1_2_weeks", "2_4_weeks"] as const;
export type LeadFilter = (typeof LEAD_FILTER_OPTIONS)[number];

const LEAD_FILTER_MAX_DAYS: Record<LeadFilter, number> = { "3_5_days": 5, "1_2_weeks": 14, "2_4_weeks": 28 };

/** The day range an option stands for: more than `after`, at most `upTo` days from today. */
export function leadFilterRange(option: LeadFilter): { after: number; upTo: number } {
  const idx = LEAD_FILTER_OPTIONS.indexOf(option);
  // The slowest option is open-ended: handling and buffer push a 2_4_weeks
  // product past its own 28-day bound, and a product that fits no option at all
  // would be reachable only from "All".
  const last = idx === LEAD_FILTER_OPTIONS.length - 1;
  return {
    after: idx > 0 ? LEAD_FILTER_MAX_DAYS[LEAD_FILTER_OPTIONS[idx - 1]] : -Infinity,
    upTo: last ? Infinity : LEAD_FILTER_MAX_DAYS[option],
  };
}

/** Whole days from `from` to `to` (ISO dates). */
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * The lead_time_class values an option shows: those whose computed arrival
 * date (the card's) is inside the option's day range. Without shipping
 * settings no card shows a date, so it falls back to the class's own upper
 * bound (LEAD_CLASS_DAYS, mirrors SQL lead_class_days()).
 */
export function leadClassesFor(
  option: LeadFilter,
  settings: ShippingSettings | null | undefined,
  today: string = todayIso()
): LeadTimeClass[] {
  const { after, upTo } = leadFilterRange(option);
  return LEAD_TIME_CLASSES.filter((c) => {
    const date = arrivesByDate(c, settings, today);
    const days = date ? daysUntil(today, date) : LEAD_CLASS_DAYS[c];
    return days > after && days <= upTo;
  });
}

export function parseLeadFilter(raw: string | null | undefined): LeadFilter | undefined {
  return raw && (LEAD_FILTER_OPTIONS as readonly string[]).includes(raw) ? (raw as LeadFilter) : undefined;
}

// ── URL state ────────────────────────────────────────────────────────────────

export type StoreState = {
  q: string;
  category?: string;
  material?: string;
  stock?: LeadFilter;
  sort: StoreSort;
  page: number;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The query params that change the listing. /store without any of them is the
 * static (ISR) default listing; with one of them next.config.mjs rewrites the
 * request to the dynamic /store/search route (same page, same URL in the
 * browser). Keep in step with the `rewrites()` there (catalog.test.ts checks).
 */
export const STORE_URL_PARAMS = ["q", "category", "material", "stock", "sort", "page"] as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_QUERY = 100;

/** Read the URL into a clean state; anything malformed falls back to the default. */
export function parseStoreParams(raw: RawSearchParams): StoreState {
  const q = (first(raw.q) ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  const category = first(raw.category)?.trim() || undefined;
  const material = first(raw.material)?.trim() || undefined;
  const page = Math.max(1, Math.trunc(Number(first(raw.page))) || 1);
  return {
    q,
    category,
    material,
    stock: parseLeadFilter(first(raw.stock)),
    sort: resolveSort(first(raw.sort), !!q),
    page,
  };
}

export type StorePatch = Partial<Omit<StoreState, "sort" | "stock">> & {
  sort?: StoreSort | "";
  stock?: LeadFilter | "";
};

/**
 * The query object for /store after applying `patch`. Empty values drop; any
 * change other than `page` resets to page 1; a default sort is left out so the
 * URL stays short and shareable.
 */
export function storeQuery(state: StoreState, patch: StorePatch = {}): Record<string, string> {
  const pageOnly = Object.keys(patch).every((k) => k === "page");
  const q = (patch.q ?? state.q).trim();
  const hasQ = !!q;
  // A sort the shopper never picked follows the query (relevance while searching).
  const implicit = state.sort === defaultSort(!!state.q);
  const sort = resolveSort("sort" in patch ? patch.sort || undefined : implicit ? undefined : state.sort, hasQ);
  const category = "category" in patch ? patch.category : state.category;
  const material = "material" in patch ? patch.material : state.material;
  const stock = "stock" in patch ? patch.stock || undefined : state.stock;
  const page = pageOnly ? patch.page ?? state.page : 1;

  const out: Record<string, string> = {};
  if (q) out.q = q;
  if (category) out.category = category;
  if (material) out.material = material;
  if (stock) out.stock = stock;
  if (sort !== defaultSort(hasQ)) out.sort = sort;
  if (page > 1) out.page = String(page);
  return out;
}

/** Search, any filter, or a non-default sort — when "Clear filters" shows (both locales). */
export function hasActiveFilters(state: StoreState): boolean {
  return !!(state.q || state.category || state.material || state.stock || state.sort !== defaultSort(!!state.q));
}

/**
 * How many controls inside the mobile "Filters" drawer are set: category,
 * material, delivery time, and a non-default sort. The search text is not
 * counted (its box stays outside the drawer).
 */
export function activeFilterCount(state: StoreState): number {
  return (
    (state.category ? 1 : 0) +
    (state.material ? 1 : 0) +
    (state.stock ? 1 : 0) +
    (state.sort !== defaultSort(!!state.q) ? 1 : 0)
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

export type EmptyState =
  | { kind: "search"; clearFilters: boolean } // a search found nothing
  | { kind: "filters" } // no search, the filters found nothing
  | { kind: "page" } // results exist, but not on this page number
  | { kind: "catalog" }; // nothing published at all

/** Which empty state to show, or null when there is something to list. */
export function emptyState(state: StoreState, total: number, shown: number): EmptyState | null {
  if (shown > 0) return null;
  if (total > 0) return { kind: "page" };
  const filtered = !!(state.category || state.material || state.stock);
  if (state.q) return { kind: "search", clearFilters: filtered };
  if (filtered) return { kind: "filters" };
  return { kind: "catalog" };
}

// ── Search filter (PostgREST) ────────────────────────────────────────────────

/** Columns a search word may match. No brand/model columns exist on parts. */
export const SEARCH_COLUMNS = ["name", "name_ar", "sku", "category", "material"] as const;
const MAX_WORDS = 6;

/** Search words as typed, minus characters that break PostgREST filter syntax. */
export function searchTerms(q: string): string[] {
  const words = q
    .replace(/[,()%*\\"'`:]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  return Array.from(new Set(words.map((w) => w.toLowerCase()))).slice(0, MAX_WORDS);
}

/**
 * One PostgREST `or` filter: every word must match at least one column
 * (case-insensitive substring). An Arabic word that names a category ("حساسات")
 * also matches that category's stored English value. Null when nothing is left.
 *
 * `storeCategory` (0048 has run): parts.store_category is searched too, and
 * an Arabic category word matches either column — the store category
 * ("طابعة" → 3D printing) or an older source category ("أطقم" → Kits).
 */
export function searchFilter(q: string, opts: { storeCategory?: boolean } = {}): string | null {
  const catColumns = opts.storeCategory ? ["category", "store_category"] : ["category"];
  const groups = searchTerms(q).map((w) => {
    const alts: string[] = SEARCH_COLUMNS.map((c) => `${c}.ilike.%${w}%`);
    if (opts.storeCategory) alts.push(`store_category.ilike.%${w}%`);
    const cats = categoriesForArabicTerm(w);
    if (cats.length) {
      const list = cats.map((c) => `"${c.replace(/"/g, "")}"`).join(",");
      for (const col of catColumns) alts.push(`${col}.in.(${list})`);
    }
    return alts.join(",");
  });
  if (!groups.length) return null;
  if (groups.length === 1) return groups[0];
  return `and(${groups.map((g) => `or(${g})`).join(",")})`;
}
