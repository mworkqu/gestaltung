import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/parts/part-card";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";
import { parseStoreParams, type StoreCardPart } from "@/lib/store/catalog";
import { getCardsBySkus, getOccasions, getStoreListing } from "@/lib/store/public-catalog";
import { loadShippingSettings } from "@/lib/store/shipping-settings";
import {
  formatOccasionDate,
  occasionBanner,
  occasionSearchState,
  occasionStatus,
  occasionTitle,
  qatarToday,
  type Occasion,
} from "@/lib/occasions";
import { pageMetadata, SITE_NAME } from "@/lib/seo";
import { arabicCountForm } from "@/lib/text/count";
import { cn } from "@/lib/utils";

// An occasion's collection page (P3-07 / WF-08): /store/collections/<id>.
// ISR like the rest of the storefront: it reads only cached, cookie-free data
// (store_settings.occasions + the catalogue helpers) and never searchParams /
// cookies / headers. It stays reachable all year: outside its dates the hero
// says when it is back instead of 404ing, so shared links keep working. An id
// that is not in store_settings.occasions is a 404.
export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const occasions = await getOccasions();
  return routing.locales.flatMap((locale) => occasions.map((o) => ({ locale, id: o.id })));
}

async function findOccasion(id: string): Promise<Occasion | undefined> {
  return (await getOccasions()).find((o) => o.id === id);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const occasion = await findOccasion(id);
  if (!occasion) return {};
  const t = await getTranslations({ locale, namespace: "Occasions" });
  const title = occasionTitle(occasion, locale);
  return pageMetadata({
    locale,
    path: `/store/collections/${occasion.id}`,
    title: `${title} | ${SITE_NAME}`,
    description: occasionBanner(occasion, locale) || t("metaFallback", { title }),
  });
}

export default async function OccasionCollectionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const occasion = await findOccasion(id);
  if (!occasion) notFound();

  const t = await getTranslations("Occasions");
  const tp = await getTranslations("Parts");
  const tn = await getTranslations("Nav");
  const today = qatarToday();
  const status = occasionStatus(occasion, today);
  const title = occasionTitle(occasion, locale);
  const line = occasionBanner(occasion, locale);
  const start = formatOccasionDate(occasion.start, locale);
  const end = formatOccasionDate(occasion.end, locale);
  const range = t("range", { start, end });
  const statusText =
    status === "on"
      ? t("onNow")
      : status === "back"
        ? t("backOn", { range })
        : status === "upcoming"
          ? t("startsOn", { date: start })
          : t("endedOn", { date: end });

  // Explicit SKUs win; if none of them is listed any more, fall back to the
  // search so the page is never empty while the query still finds products.
  const wanted = occasionSearchState(occasion);
  const listingQuery = occasion.query ? parseStoreParams({ q: occasion.query }) : null;
  let parts: StoreCardPart[] = [];
  let total = 0;
  if ("skus" in wanted) {
    parts = await getCardsBySkus(wanted.skus);
    total = parts.length;
  }
  if (parts.length === 0 && listingQuery) {
    const listing = await getStoreListing(listingQuery, locale);
    parts = listing.parts;
    total = listing.total;
  }

  const [shipping, turnstileEnabled] = await Promise.all([loadShippingSettings(), turnstileEnabledForPages()]);
  const allResults = occasion.query ? { pathname: "/store" as const, query: { q: occasion.query } } : null;
  const arrow = cn("h-4 w-4", locale === "ar" && "-scale-x-100");

  return (
    <MessagesScope scope="store">
      <div className="container page-stack">
        <nav aria-label={t("breadcrumb")} className="flex items-center gap-1 text-sm text-mutedtext">
          <Link href="/store" className="inline-flex min-h-11 items-center hover:text-cobalt">
            {tn("shopParts")}
          </Link>
          <ChevronRight className={cn("h-4 w-4", locale === "ar" && "-scale-x-100")} aria-hidden />
          <span className="text-heading">
            <IsolatedTitle text={title} locale={locale} />
          </span>
        </nav>

        <header className="neu animate-fade-up space-y-3 hero-pad">
          <p className="kicker text-azure">
            {t("kicker")}
            <span className="text-mutedtext"> · {statusText}</span>
          </p>
          <h1 className="title-page">
            <IsolatedTitle text={title} locale={locale} />
          </h1>
          {line && (
            <p className="max-w-2xl text-base leading-relaxed text-body">
              <IsolatedTitle text={line} locale={locale} />
            </p>
          )}
          <p className="text-sm text-mutedtext">{range}</p>
        </header>

        {parts.length === 0 ? (
          <div className="neu flex flex-col items-center gap-4 p-6 text-center sm:p-12">
            <p className="text-base font-semibold text-heading">{t("empty")}</p>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/store">{t("browseStore")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-mutedtext">{tp("resultCount", { count: total, form: arabicCountForm(total) })}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {parts.map((part, i) => (
                <PartCard key={part.id} part={part} locale={locale} shipping={shipping} priority={i < 4} />
              ))}
            </div>
            {allResults && (
              <Link
                href={allResults}
                className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-cobalt hover:text-cobalt-hover"
              >
                {t("seeAll")}
                <ArrowRight className={arrow} aria-hidden />
              </Link>
            )}
          </>
        )}
        {/* Add to cart may mint a guest session: the on-demand check (renders nothing while off). */}
        <TurnstileChallenge enabled={turnstileEnabled} />
      </div>
    </MessagesScope>
  );
}
