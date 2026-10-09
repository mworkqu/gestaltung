import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { renderBlock } from "@/components/legal/legal-document";
import { getCaseStudy, listCaseStudies, localizedCaseStudy } from "@/lib/case-studies";
import { clipText, pageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";

// One story (P4-04), static. Only published slugs are built and anything else
// is a 404, so an unpublished story (such as the shipped example) never renders.
export const dynamicParams = false;

export function generateStaticParams() {
  const slugs = listCaseStudies({ publishedOnly: true }).map((c) => c.slug);
  return routing.locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

function publishedStory(slug: string) {
  const story = getCaseStudy(slug);
  return story && story.published ? story : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const story = publishedStory(slug);
  if (!story) return {};
  const l = localizedCaseStudy(story, locale);
  return pageMetadata({
    locale,
    path: `/case-studies/${story.slug}`,
    title: `${l.title} | Gestaltung360`,
    description: clipText(l.summary, 155),
    type: "article",
  });
}

export default async function CaseStudyPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const story = publishedStory(slug);
  if (!story) notFound();

  const t = await getTranslations("CaseStudies");
  const l = localizedCaseStudy(story, locale);
  const arrow = cn("h-4 w-4", locale === "ar" && "-scale-x-100");

  return (
    <div className="container page-stack">
      <section className="neu animate-fade-up flex flex-col gap-5 hero-pad">
        <Link
          href="/case-studies"
          className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          <ArrowLeft className={arrow} aria-hidden />
          {t("backToAll")}
        </Link>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className="kicker text-mutedtext">{t(`sector_${story.sector}`)}</span>
        </span>
        <h1 className="max-w-3xl text-balance break-words title-page">{l.title}</h1>
        {l.persona ? <p className="text-base font-semibold text-mutedtext">{l.persona}</p> : null}
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{l.summary}</p>
      </section>

      {l.outcome.length > 0 ? (
        <section className="neu animate-fade-up delay-1 card-pad">
          <h2 className="mb-5 title-section">{t("outcomeHeading")}</h2>
          <ul className="space-y-3">
            {l.outcome.map((line, i) => (
              <li key={i} className="flex min-w-0 items-start gap-3 text-base leading-relaxed text-body">
                <Check className="mt-1 h-4 w-4 shrink-0 text-cobalt" aria-hidden />
                <span className="min-w-0 break-words">{line}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {l.body.length > 0 ? (
        <article className="neu animate-fade-up delay-2 w-full max-w-3xl space-y-4 break-words card-pad">
          {l.body.map(renderBlock)}
        </article>
      ) : null}

      <section className="animate-fade-up delay-3 overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="max-w-xl space-y-2">
            <h2 className="title-section text-white">{t("ctaHeading")}</h2>
            <p className="text-sm leading-relaxed text-white/70 sm:text-base">{t("ctaText")}</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg" variant="secondary" className="w-full rounded-full px-7 sm:w-auto">
              <Link href="/projects/new">{t("ctaPrimary")}</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="w-full rounded-full border-white/30 px-7 text-white hover:bg-white/10 hover:text-white sm:w-auto"
            >
              <Link href="/store">
                {t("ctaSecondary")}
                <ArrowRight className={arrow} aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
