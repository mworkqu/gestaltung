import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, CalendarCheck, CreditCard, Warehouse } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { OccasionBanner } from "@/components/store/occasion-banner";
import { BlueprintDecor, V2_TITLE } from "@/components/marketing/v2";
import { parseStoreParams } from "@/lib/store/catalog";
import { v2PageMetadata } from "@/lib/site-v2-server";
import { cn } from "@/lib/utils";
import { StoreListing } from "../../store/store-listing";

// v2 store (P3-03): a landing hero above the SAME listing. The listing, its
// search and category filters, the cards and the product pages are the v1
// ones; only the title block is replaced by this hero. Static / ISR like v1:
// it never reads searchParams (a filtered URL is rewritten to the dynamic
// search route by next.config.mjs, which renders the v1 listing).
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return v2PageMetadata({ locale, path: "/store", title: t("storeTitle"), description: t("storeDescription") });
}

export default async function StoreV2({ params }: { params: Promise<{ locale: string }> }) {
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
        <section className="neu animate-fade-up relative overflow-hidden px-5 py-10 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
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
