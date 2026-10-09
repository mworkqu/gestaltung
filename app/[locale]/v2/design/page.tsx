import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Cog, PencilRuler, Printer, Scissors, UploadCloud, Zap } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { DesignDropzone } from "@/components/design/design-dropzone";
import { FeatureVideoSection } from "@/components/feature-video-section";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { BlueprintDecor, SectionHead, V2_TITLE } from "@/components/marketing/v2";
import { formatQar } from "@/lib/pricing/plans";
import { getServicePrices } from "@/lib/store/public-catalog";
import { v2PageMetadata } from "@/lib/site-v2-server";
import { cn } from "@/lib/utils";

// v2 "Get a part made" hub (P3-03, plan 5.3): upload to a quote, the drawing
// service with its prices (store_settings.service_prices), what the studio
// makes, the two videos. Static like v1 (no revalidate in v1: the prices come
// from the cached settings read, so the tag refreshes them).
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "DesignHub" });
  return v2PageMetadata({ locale, path: "/design", title: t("metaTitle"), description: t("metaDescription") });
}

export default async function DesignHubV2({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("DesignHub");
  const ts = await getTranslations("SiteV2");
  const tp = await getTranslations("Pricing");
  const prices = await getServicePrices();
  const isRtl = locale === "ar";
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  const tiers = [
    { label: ts("designTierSimple"), price: ts("designPriceQar", { n: formatQar(prices.drawing_simple) }) },
    { label: ts("designTierAssembly"), price: ts("designPriceQar", { n: formatQar(prices.drawing_assembly) }) },
    { label: ts("designTierComplex"), price: tp("fromQar", { n: formatQar(prices.drawing_complex_from) }) },
  ];

  const methods = [
    { icon: Printer, title: ts("designMake1Title"), text: ts("designMake1Text") },
    { icon: Cog, title: ts("designMake2Title"), text: ts("designMake2Text") },
    { icon: Scissors, title: ts("designMake3Title"), text: ts("designMake3Text") },
    { icon: Zap, title: ts("designMake4Title"), text: ts("designMake4Text") },
  ];

  return (
    <MessagesScope scope="home">
      <div className="container page-stack">
        {/* Hero */}
        <section className="neu animate-fade-up relative overflow-hidden px-5 py-10 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
          <BlueprintDecor />
          <div className="relative max-w-4xl space-y-5 sm:space-y-7">
            <span className="kicker block text-mutedtext">{t("kicker")}</span>
            <h1 className={V2_TITLE}>{t("heading")}</h1>
            <p className="max-w-2xl text-base leading-relaxed text-body sm:text-xl">{ts("designSub")}</p>
            {/* Maybe it is already sold: look in the store first. */}
            <Link
              href="/store"
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
            >
              {t("searchLabel")}
              <ArrowRight className={arrow} aria-hidden />
            </Link>
          </div>
        </section>

        {/* Two ways in: upload a file, or have it drawn. */}
        <section className="animate-fade-up delay-1 space-y-4">
          <span className="kicker block px-1 text-cobalt">{t("pathsTag")}</span>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Upload to quote */}
            <div className="neu flex min-w-0 flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cobalt shadow-neu-sm">
                  <UploadCloud className="h-6 w-6 text-white" strokeWidth={1.5} aria-hidden />
                </span>
                <h2 className="text-balance title-section">{ts("designUploadTitle")}</h2>
              </div>
              <DesignDropzone compact hideExplore />
              <FeatureVideoSection slug="file-to-part" locale={locale} size="small" href="/design/quote" />
            </div>

            {/* Drawing service */}
            <div className="neu flex min-w-0 flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
                  <PencilRuler className="h-6 w-6 text-cobalt" strokeWidth={1.5} aria-hidden />
                </span>
                <div className="min-w-0 space-y-1">
                  <span className="kicker block text-cobalt">{ts("designDrawKicker")}</span>
                  <h2 className="text-balance title-section">{t("drawingTitle")}</h2>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-body sm:text-base">{t("drawingCopy")}</p>

              <div className="space-y-3">
                <span className="kicker block text-mutedtext">{tp("pricesFromTag")}</span>
                <dl className="grid gap-3 sm:grid-cols-3">
                  {tiers.map(({ label, price }) => (
                    <div key={label} className="tile min-w-0">
                      <dt className="text-xs font-semibold leading-snug text-mutedtext">{label}</dt>
                      <dd className="mt-1 text-base font-extrabold tabular-nums text-heading">{price}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <Button asChild size="lg" className="rounded-full">
                  <Link href="/design/drawing">{ts("designDrawCta")}</Link>
                </Button>
                <Link
                  href="/pricing"
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                >
                  {tp("seeAll")}
                  <ArrowRight className={arrow} aria-hidden />
                </Link>
              </div>

              <FeatureVideoSection slug="sketch-to-drawing" locale={locale} size="small" href="/design/drawing" />
            </div>
          </div>
        </section>

        {/* What the studio makes */}
        <section aria-labelledby="v2-make" className="neu animate-fade-up delay-2 space-y-6 card-pad">
          <SectionHead
            id="v2-make"
            kicker={ts("designMakeKicker")}
            title={ts("designMakeHeading")}
            intro={ts("designMakeIntro")}
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {methods.map(({ icon: Icon, title, text }) => (
              <li key={title} className="tile min-w-0">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                  <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                </span>
                <h3 className="mt-4 title-card">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mutedtext">{text}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-heading">{ts("designMakeNote")}</p>
        </section>

        {/* Closing band */}
        <section className="animate-fade-up delay-3 overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0 opacity-[0.04]" />
            <div className="relative space-y-2">
              <span
                className={cn("block text-[10px] text-white/45", isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]")}
              >
                {t("ctaTag")}
              </span>
              <h2 className="title-section text-white">{t("ctaHeading")}</h2>
            </div>
            <Button asChild size="lg" variant="secondary" className="relative rounded-full px-7">
              <Link href="/contact">{t("ctaButton")}</Link>
            </Button>
          </div>
        </section>
      </div>
    </MessagesScope>
  );
}
