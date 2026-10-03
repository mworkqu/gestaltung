import { getTranslations, setRequestLocale } from "next-intl/server";
import { MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/parts/part-card";
import { PartsFilters } from "@/components/parts/parts-filters";
import { DemandBeacon } from "@/components/parts/demand-beacon";
import { RequestItemButton } from "@/components/parts/request-item-button";
import { isListed, listedCategories } from "@/lib/store/categories";
import {
  emptyState,
  leadClassesFor,
  parseStoreParams,
  searchFilter,
  storeQuery,
  STORE_CARD_COLUMNS,
  STORE_PAGE_SIZE,
  type RawSearchParams,
  type StoreCardPart,
} from "@/lib/store/catalog";
import { sortProducts } from "@/lib/store/search";
import { loadShippingSettings } from "@/lib/store/shipping-settings";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";

// Published catalog reflects admin publish toggles immediately. (No cookies or
// headers are read here — the anon public client — so this can become ISR.)
export const dynamic = "force-dynamic";

// A search ranks every matching row before paging; the catalogue is a few
// hundred to ~1,000 products, so this stays a handful of slim rows.
const MAX_SEARCH_ROWS = 3000;

export const generateMetadata = metaFor("store");

export default async function PartsStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale } = await params;
  const state = parseStoreParams(await searchParams);
  setRequestLocale(locale);

  const t = await getTranslations("Parts");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = createPublicClient();

  // Filter options: every listed category and material, read from the data (so
  // a category rename needs no code change). Paged past PostgREST's 1,000 cap.
  type FacetRow = { category: string | null; material: string | null; is_published: boolean; merged_into: string | null };
  const facetRows: FacetRow[] = supabase
    ? (
        await fetchAllRows<FacetRow>((from, to) =>
          supabase
            .from("parts")
            .select("category, material, is_published, merged_into")
            .eq("is_published", true)
            .not("lead_time_class", "is", null)
            .order("id")
            .range(from, to)
        )
      ).rows
    : [];
  const categories = listedCategories(facetRows);
  const materials = Array.from(
    new Set(facetRows.filter(isListed).map((p) => p.material).filter((m): m is string => !!m))
  ).sort();

  // The catalogue: filtered in the database, only the card's columns.
  const filter = searchFilter(state.q);
  const base = (withCount: boolean) => {
    let query = supabase!
      .from("parts")
      .select(STORE_CARD_COLUMNS, withCount ? { count: "exact" } : undefined)
      .eq("is_published", true)
      .is("merged_into", null)
      // Nothing without a delivery date is listed (owner, 2026-09-29); its
      // page still opens from an old link.
      .not("lead_time_class", "is", null);
    if (state.category) query = query.eq("category", state.category);
    if (state.material) query = query.eq("material", state.material);
    if (state.stock) query = query.in("lead_time_class", leadClassesFor(state.stock));
    if (filter) query = query.or(filter);
    return query;
  };

  let parts: StoreCardPart[] = [];
  let total = 0;
  const from = (state.page - 1) * STORE_PAGE_SIZE;
  if (supabase && filter) {
    // Search: every matching slim row, ranked / sorted here, then one page.
    const { rows } = await fetchAllRows<StoreCardPart>((a, b) => base(false).order("id").range(a, b), 1000, MAX_SEARCH_ROWS);
    const sorted = sortProducts(rows, state.sort, state.q, locale);
    total = sorted.length;
    parts = sorted.slice(from, from + STORE_PAGE_SIZE);
  } else if (supabase) {
    // Browse: sorted and paged in the database.
    let query = base(true);
    if (state.sort === "price_asc" || state.sort === "price_desc") {
      query = query.order("unit_price", { ascending: state.sort === "price_asc" });
    }
    if (locale === "ar") query = query.order("name_ar", { ascending: true, nullsFirst: false });
    query = query.order("name", { ascending: true }).order("id", { ascending: true });
    const { data, count } = await query.range(from, from + STORE_PAGE_SIZE - 1);
    parts = (data ?? []) as StoreCardPart[];
    total = count ?? parts.length;
  }

  // The Standard-tier delivery settings, read once for every card's "Arrives by".
  const shipping = await loadShippingSettings();

  const pages = Math.max(1, Math.ceil(total / STORE_PAGE_SIZE));
  const href = (patch: Parameters<typeof storeQuery>[1]) => ({ pathname: "/store" as const, query: storeQuery(state, patch) });
  const empty = emptyState(state, total, parts.length);

  const waHref = (text: string) => `${COMPANY_WHATSAPP.url}?text=${encodeURIComponent(text)}`;
  const whatsapp = (text: string) => (
    <div className="flex flex-col items-center gap-1">
      <Button asChild variant="outline" className="rounded-full">
        <a href={waHref(text)} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="h-4 w-4" />
          {t("emptyCta")}
        </a>
      </Button>
      <span dir="ltr" className="text-xs tabular-nums text-mutedtext">{COMPANY_WHATSAPP.display}</span>
    </div>
  );
  const pill = "rounded-full border border-borderstrong px-4 py-1.5 text-sm text-heading hover:border-cobalt";

  return (
    <div className="container space-y-8 py-8">
      <header className="space-y-3">
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body">
          {t("subtext")}
        </p>
      </header>

      <PartsFilters categories={categories} materials={materials} state={state} />

      {empty ? (
        <div className="neu flex flex-col items-center gap-4 p-12 text-center">
          {empty.kind === "search" && (
            <>
              <DemandBeacon kind="zero_search" searchTerm={state.q} />
              <p className="max-w-lg text-base font-semibold text-heading">{t("emptySearchTitle", { q: state.q })}</p>
              <p className="max-w-md text-sm text-mutedtext">{t("emptySearchBody")}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <RequestItemButton itemName={state.q} variant="default" size="default" />
                <Link href={href({ q: "" })} className={pill}>{t("searchClear")}</Link>
                {empty.clearFilters && <Link href="/store" className={pill}>{t("clearFilters")}</Link>}
              </div>
              {whatsapp(t("emptyWhatsappSearch", { q: state.q }))}
            </>
          )}
          {empty.kind === "filters" && (
            <>
              <p className="text-base font-semibold text-heading">{t("emptyFiltersTitle")}</p>
              <Link href="/store" className={pill}>{t("clearFilters")}</Link>
              {whatsapp(t("emptyWhatsapp"))}
            </>
          )}
          {empty.kind === "page" && (
            <>
              <p className="text-base font-semibold text-heading">{t("emptyTitle")}</p>
              <Link href={href({ page: 1 })} className={pill}>{t("emptyPageBack")}</Link>
            </>
          )}
          {empty.kind === "catalog" && (
            <>
              <p className="text-base font-semibold text-heading">{t("emptyTitle")}</p>
              {whatsapp(t("emptyWhatsapp"))}
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-mutedtext" aria-live="polite">{t("resultCount", { count: total })}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {parts.map((part) => (
              <PartCard key={part.id} part={part} locale={locale} shipping={shipping} />
            ))}
          </div>
          {pages > 1 && (
            <nav className="flex items-center justify-center gap-3 text-sm" aria-label={t("pagination")}>
              {state.page > 1 ? (
                <Link href={href({ page: Math.min(state.page - 1, pages) })} className={pill}>
                  {t("prevPage")}
                </Link>
              ) : null}
              <span className="tabular-nums text-mutedtext">{t("pageOf", { page: state.page, pages })}</span>
              {state.page < pages ? (
                <Link href={href({ page: state.page + 1 })} className={pill}>
                  {t("nextPage")}
                </Link>
              ) : null}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
