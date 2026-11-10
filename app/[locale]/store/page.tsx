import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, CalendarCheck, CreditCard, Warehouse } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { OccasionBanner } from "@/components/store/occasion-banner";
import { BlueprintDecor, V2_TITLE } from "@/components/marketing/v2";
import { parseStoreParams } from "@/lib/store/catalog";
import { pageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { StoreListing } from "./store-listing";

// /store (P3-03, the former /v2 store): a landing hero above the shared
// listing (store-listing.tsx, also rendered by ./search). Static / ISR: it
// never reads searchParams. A URL with ?q / ?category / ?material / ?stock /
// ?sort / ?page is rewritten (next.config.mjs) to ./search/page.tsx, which
// renders the same listing dynamically from cached data.
export const revalidate = 86400; // = STOREFRONT_REVALIDATE (lib/cache/storefront.ts); the daily sync purges by tag

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return pageMetadata({ locale, path: "/store", title: t("storeTitle"), description: t("storeDescription") });
}

export default async function StorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Parts");
  const ts = await getTranslations("SiteV2");
  const tl = await getTranslations("StoreLanding");
  const isRtl = locale === "ar";

  const proof = [
    { icon: CalendarCheck, text: ts("storeProof1") },
    { icon: Warehouse, text: ts("storeProof2") },
    { icon: CreditCard, text: ts("storeProof3") },
  ];

  return (
    <>
      <div className="container page-stack">
        <section className="neu animate-rise relative overflow-hidden px-5 py-10 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
          <BlueprintDecor />
          <div className="relative max-w-4xl space-y-5 sm:space-y-6">
            <span className="kicker block text-mutedtext">{t("kicker")}</span>
            <h1 className={V2_TITLE}>{t("heading")}</h1>
            <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("subtext")}</p>
            <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-8">
              {proof.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 text-sm font-medium text-heading">
                  <Icon className="h-4 w-4 shrink-0 text-cobalt" strokeWidth={1.75} aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
            <Link
              href="/design"
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
            >
              {tl("customTitle")} {tl("customBtn")}
              <ArrowRight className={cn("h-4 w-4", isRtl && "-scale-x-100")} aria-hidden />
            </Link>
          </div>
        </section>

        <OccasionBanner locale={locale} />
      </div>

      {/* The same listing as /store: search, category chips, filters, cards, paging. */}
      <StoreListing locale={locale} state={parseStoreParams({})} hideHeader />
    </>
  );
}
