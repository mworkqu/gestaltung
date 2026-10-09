import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  GraduationCap,
  Lightbulb,
  MessageCircle,
  PackageCheck,
  Plus,
  Rocket,
  Search,
  ShoppingBag,
  UploadCloud,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { DesignDropzone } from "@/components/design/design-dropzone";
import { PartCard } from "@/components/parts/part-card";
import { HomeCallback } from "@/components/store-landing/callback-form";
import { YourWorkStrip } from "@/components/home/your-work-strip";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { TrackClick } from "@/components/analytics/track-click";
import { FeatureVideoSection } from "@/components/feature-video-section";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { BlueprintDecor, ChoiceHead, CreditsFlow, SectionHead, V2_TITLE } from "@/components/marketing/v2";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";
import { getFeaturedParts, getStoreFacets } from "@/lib/store/public-catalog";
import { categoryLabel } from "@/lib/store/category-label";
import { v2PageMetadata } from "@/lib/site-v2-server";
import { VIDEOS, videoBase, videoJsonLd } from "@/lib/videos";
import { cn } from "@/lib/utils";

// v2 home (P3-03, plan 5.2). Same ISR rule as the v1 home: static per locale,
// re-rendered at most every 5 minutes. Nothing per-visitor is rendered here
// (auth, cart and credits are client components); the site flag is resolved in
// middleware, never with cookies() or headers() in this page. The trust block
// is rendered site-wide above the footer by the locale layout, not here.
export const revalidate = 300;

// Same title and description as v1; canonical and hreflang point at the public
// path "/"; noindex until the site_v2 flag is on (lib/site-v2-server.ts).
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "StoreLanding" });
  return v2PageMetadata({ locale, path: "", title: t("metaTitle"), description: t("metaDescription") });
}

export default async function HomeV2({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("StoreLanding");
  const tv = await getTranslations("Videos");
  const ts = await getTranslations("SiteV2");
  const isRtl = locale === "ar";
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const [products, { categories }, turnstileEnabled] = await Promise.all([
    getFeaturedParts(),
    getStoreFacets(),
    turnstileEnabledForPages(),
  ]);

  // VideoObject structured data only for a clip that is really uploaded (lib/videos.ts `published`).
  const heroVideo = VIDEOS.find((v) => v.slug === "idea-to-kit");
  const heroVideoLd = heroVideo?.published
    ? videoJsonLd({
        entry: heroVideo,
        base: videoBase(process.env.NEXT_PUBLIC_SUPABASE_URL),
        name: tv(heroVideo.titleKey),
        description: tv(heroVideo.descriptionKey),
        locale,
      })
    : null;

  return (
    <MessagesScope scope="home">
      <div className="container page-stack">
        {/* P3-05: signed-in "Your work" strip. Client-only: renders nothing until a session exists. */}
        <YourWorkStrip />

        {/* 1. Hero: outcome, one sub line, ONE primary CTA, a small shop link, the proof line. */}
        <section className="neu animate-fade-up relative overflow-hidden px-5 pb-8 pt-8 sm:px-12 sm:pb-12 sm:pt-14 lg:px-16 lg:pb-16 lg:pt-20">
          <BlueprintDecor />
          <div className="relative space-y-4 sm:space-y-7">
            <h1 className={cn(V2_TITLE, "max-w-4xl")}>{t("heroH1")}</h1>
            <p className="max-w-2xl text-base leading-relaxed text-body sm:text-xl">{t("heroSub")}</p>
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-8">
              <TrackClick event="path_chosen" params={{ path: "plan" }}>
                <Button asChild size="lg" className="w-full rounded-full sm:h-14 sm:w-auto sm:px-9 sm:text-base">
                  <Link href="/projects/new">{t("heroPrimary")}</Link>
                </Button>
              </TrackClick>
              <TrackClick event="path_chosen" params={{ path: "shop" }}>
                <Link
                  href="/store"
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                >
                  {t("heroSecondary")}
                  <ArrowRight className={arrow} />
                </Link>
              </TrackClick>
            </div>
            <p
              className={mono(
                "border-t border-borderstrong/40 pt-4 text-[11px] normal-case leading-relaxed tracking-normal text-mutedtext sm:pt-5 sm:text-xs",
              )}
            >
              <IsolatedTitle text={t("heroProof")} locale={locale} />
            </p>
          </div>
        </section>

        {/* P3-07: occasion banner goes here */}

        {/* 2. Built for founders: three outcomes as flat tiles. */}
        <section aria-labelledby="v2-founders" className="neu animate-fade-up space-y-6 card-pad">
          <SectionHead
            id="v2-founders"
            kicker={t("foundersKicker")}
            title={t("foundersHeading")}
            intro={t("foundersIntro")}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="tile min-w-0">
              <ChoiceHead icon={<Rocket className="h-4 w-4" />} title={t("founders1Title")} text={t("founders1Text")} />
            </div>
            <div className="tile min-w-0">
              <ChoiceHead
                icon={<PackageCheck className="h-4 w-4" />}
                title={t("founders2Title")}
                text={t("founders2Text")}
              />
            </div>
            <div className="tile min-w-0">
              <ChoiceHead
                icon={<MessageCircle className="h-4 w-4" />}
                title={t("founders3Title")}
                text={t("founders3Text")}
              />
            </div>
          </div>
        </section>

        {/* 3. Paths: Plan / Make / Shop, compact (same functions as v1). */}
        <section className="space-y-3">
          <h2 className="sr-only">{t("heroChoose")}</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Plan a product */}
            <div className="neu animate-fade-up delay-1 flex min-w-0 flex-col gap-4 p-5">
              <ChoiceHead
                icon={<Lightbulb className="h-4 w-4" />}
                title={t("choiceIdeaTitle")}
                text={t("choiceIdeaText")}
              />
              <p className="text-[11px] leading-relaxed text-mutedtext">{t("choiceIdeaDatasheet")}</p>
              <div className="mt-auto space-y-2">
                <TrackClick event="path_chosen" params={{ path: "plan" }}>
                  <Button asChild size="lg" className="w-full rounded-2xl">
                    <Link href="/projects/new">
                      <Plus className="me-2 h-4 w-4" />
                      {t("choiceIdeaCta")}
                    </Link>
                  </Button>
                </TrackClick>
                <p className="text-center text-[11px] text-mutedtext">{ts("planNote")}</p>
              </div>
            </div>

            {/* Get a part made */}
            <div className="neu animate-fade-up delay-1 flex min-w-0 flex-col gap-4 p-5">
              <ChoiceHead
                icon={<UploadCloud className="h-4 w-4" />}
                title={t("choiceMakeTitle")}
                text={t("choiceMakeText")}
              />
              <DesignDropzone compact />
              <TrackClick event="path_chosen" params={{ path: "make" }}>
                <Link
                  href="/design/drawing"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover max-md:min-h-11"
                >
                  {t("drawLink")}
                  <ArrowRight className={arrow} />
                </Link>
              </TrackClick>
            </div>

            {/* Shop parts */}
            <div className="neu animate-fade-up delay-1 flex min-w-0 flex-col gap-4 p-5">
              <ChoiceHead
                icon={<ShoppingBag className="h-4 w-4" />}
                title={t("choiceBuyTitle")}
                text={t("choiceBuyText")}
              />
              <form action={`/${locale}/store`} className="flex items-stretch gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/60 bg-panel px-3 shadow-neu-inset">
                  <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
                  <input
                    name="q"
                    aria-label={t("searchPh")}
                    placeholder={t("searchPh")}
                    className="w-full min-w-0 flex-1 bg-transparent py-2.5 text-sm text-heading outline-none placeholder:text-faint"
                  />
                </div>
                <Button type="submit" className="rounded-2xl px-4">
                  {t("searchBtn")}
                </Button>
              </form>
              <TrackClick event="path_chosen" params={{ path: "shop" }}>
                <Link
                  href="/store"
                  className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover max-md:min-h-11"
                >
                  {t("choiceBuyCta")}
                  <ArrowRight className={arrow} />
                </Link>
              </TrackClick>
            </div>
          </div>
        </section>

        {/* 4. The 45-second video (idea to kit). */}
        <section aria-labelledby="v2-video" className="neu animate-fade-up delay-1 card-pad">
          <div className="grid items-center gap-8 lg:grid-cols-5 lg:gap-12">
            <div className="space-y-6 lg:col-span-2">
              <SectionHead
                id="v2-video"
                kicker={tv("seeItWorkKicker")}
                title={ts("videoHeading")}
                intro={ts("videoText")}
              />
              <TrackClick event="path_chosen" params={{ path: "plan" }}>
                <Button asChild size="lg" className="rounded-full">
                  <Link href="/projects/new">{t("heroPrimary")}</Link>
                </Button>
              </TrackClick>
            </div>
            <div className="min-w-0 lg:col-span-3">
              <FeatureVideoSection slug="idea-to-kit" locale={locale} size="large" />
            </div>
          </div>
          {heroVideoLd && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(heroVideoLd).replace(/</g, "\\u003c") }}
            />
          )}
        </section>

        {/* 5. Featured products (kits join this row once P3-07 lands). */}
        <section className="animate-fade-up delay-2 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4 px-1">
            <div>
              <h2 className="title-section">{t("featured")}</h2>
              <p className="mt-1 text-sm text-mutedtext">{t("featuredSubOrderable")}</p>
            </div>
            <Link
              href="/store"
              className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover max-md:min-h-11"
            >
              {t("viewAll")}
            </Link>
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1">
              {categories.map((category) => (
                <Link
                  key={category}
                  href={{ pathname: "/store", query: { category } }}
                  className="rounded-full bg-panel px-3.5 py-1.5 text-xs font-medium text-mutedtext shadow-neu-sm transition-colors hover:text-cobalt max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-4"
                >
                  {categoryLabel(category, locale)}
                </Link>
              ))}
            </div>
          )}

          {products.length === 0 ? (
            <div className="neu p-10 text-center">
              <p className="text-sm text-mutedtext">{t("emptyFeatured")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {products.map((part, i) => (
                <PartCard key={part.id} part={part} locale={locale} priority={i < 4} />
              ))}
            </div>
          )}
        </section>

        {/* 6. How credits work: one diagram, then the full rules on /pricing#credits. */}
        <CreditsFlow locale={locale} />

        {/* 7. The trust block is rendered site-wide above the footer (layout), so it is not repeated here. */}

        {/* 8. Schools and students: one slim row, the full story is on /students. */}
        <section className="neu animate-fade-up delay-2 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-panel text-cobalt shadow-neu-sm"
              aria-hidden
            >
              <GraduationCap className="h-4 w-4" />
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="title-card">{t("studentsTitle")}</h3>
              <p className="text-sm leading-relaxed text-body">{t("studentsText")}</p>
            </div>
          </div>
          <Link
            href="/students"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("studentsCta")}
            <ArrowRight className={arrow} />
          </Link>
        </section>

        {/* 9. Callback form. */}
        <HomeCallback turnstileEnabled={turnstileEnabled} />
        {/* Add to cart may mint a guest session: the on-demand check (renders nothing while off). */}
        <TurnstileChallenge enabled={turnstileEnabled} />
      </div>
    </MessagesScope>
  );
}
