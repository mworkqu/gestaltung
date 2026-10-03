import { getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/parts/part-card";
import { PartsFilters } from "@/components/parts/parts-filters";
import { BackToTop } from "@/components/back-to-top";
import { DemandBeacon } from "@/components/parts/demand-beacon";
import { RequestItemButton } from "@/components/parts/request-item-button";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { emptyState, storeQuery, STORE_PAGE_SIZE, type StoreState } from "@/lib/store/catalog";
import { getStoreFacets, getStoreListing } from "@/lib/store/public-catalog";
import { loadShippingSettings } from "@/lib/store/shipping-settings";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";
import { arabicCountForm } from "@/lib/text/count";

// The /store list, shared by the static default listing (store/page.tsx, no
// query params) and the dynamic search/filter route (store/search/page.tsx,
// reached through the next.config.mjs rewrite when the URL has any of
// STORE_URL_PARAMS). Reads only cached, cookie-free data
// (lib/store/public-catalog.ts) and sends cards only StoreCardPart fields.
export async function StoreListing({ locale, state }: { locale: string; state: StoreState }) {
  const t = await getTranslations("Parts");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // Filter options (every listed category/material) and one page of cards,
  // plus the Standard-tier delivery settings for every card's "Arrives by".
  const [{ categories, materials }, { parts, total }, shipping] = await Promise.all([
    getStoreFacets(),
    getStoreListing(state, locale),
    loadShippingSettings(),
  ]);

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
  const pill =
    "inline-flex items-center justify-center rounded-full border border-borderstrong px-4 py-1.5 text-sm text-heading hover:border-cobalt max-md:min-h-11";

  return (
    <MessagesScope scope="store">
      <div className="container space-y-6 py-6 sm:space-y-8 sm:py-8">
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
          <div className="neu flex flex-col items-center gap-4 p-6 text-center sm:p-12">
            {empty.kind === "search" && (
              <>
                <DemandBeacon kind="zero_search" searchTerm={state.q} />
                <p className="max-w-lg break-words text-base font-semibold text-heading">{t("emptySearchTitle", { q: state.q })}</p>
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
            <p className="text-sm text-mutedtext" aria-live="polite">{t("resultCount", { count: total, form: arabicCountForm(total) })}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {/* The first row (4 cards on desktop, 2 rows on phones) is above the fold: eager, not lazy. */}
              {parts.map((part, i) => (
                <PartCard key={part.id} part={part} locale={locale} shipping={shipping} priority={state.page === 1 && i < 4} />
              ))}
            </div>
            {pages > 1 && (
              <nav className="flex flex-wrap items-center justify-center gap-3 text-sm" aria-label={t("pagination")}>
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
        <BackToTop />
      </div>
    </MessagesScope>
  );
}
