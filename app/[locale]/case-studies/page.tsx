import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { listCaseStudies, localizedCaseStudy } from "@/lib/case-studies";
import { pageMeta } from "@/lib/meta";
import { cn } from "@/lib/utils";

// Case studies (P4-04). Static: the stories are read from content/case-studies
// at build time. Only PUBLISHED stories appear; while there are none the page
// is an honest empty state and stays out of search results.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMeta(locale, "caseStudies", { noindex: listCaseStudies({ publishedOnly: true }).length === 0 });
}

export default async function CaseStudiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("CaseStudies");
  const stories = listCaseStudies({ publishedOnly: true });
  const arrow = cn("h-4 w-4", locale === "ar" && "-scale-x-100");

  return (
    <div className="container page-stack">
      <section className="neu animate-fade-up flex flex-col gap-5 hero-pad">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className="kicker text-mutedtext">{t("kicker")}</span>
        </span>
        <h1 className="max-w-3xl text-balance title-page">{t("heading")}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("intro")}</p>
      </section>

      {stories.length === 0 ? (
        <section className="neu animate-fade-up delay-1 flex flex-col gap-5 card-pad">
          <h2 className="title-section">{t("emptyHeading")}</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-body sm:text-base">{t("emptyText")}</p>
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-6">
            <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
              <Link href="/projects/new">{t("emptyCtaStart")}</Link>
            </Button>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
            >
              {t("emptyCtaContact")}
              <ArrowRight className={arrow} aria-hidden />
            </Link>
          </div>
        </section>
      ) : (
        <ul className="grid gap-6 md:grid-cols-2">
          {stories.map((story) => {
            const l = localizedCaseStudy(story, locale);
            return (
              <li key={story.slug} className="neu animate-fade-up flex min-w-0 flex-col gap-4 card-pad">
                <span className="inline-flex w-fit items-center rounded-full bg-panel px-3 py-1 shadow-neu-sm">
                  <span className="kicker text-mutedtext">{t(`sector_${story.sector}`)}</span>
                </span>
                <h2 className="break-words title-section">{l.title}</h2>
                {l.persona ? <p className="text-sm font-semibold text-mutedtext">{l.persona}</p> : null}
                <p className="text-sm leading-relaxed text-body sm:text-base">{l.summary}</p>
                <Link
                  href={`/case-studies/${story.slug}`}
                  className="mt-auto inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                >
                  {t("readStory")}
                  <ArrowRight className={arrow} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
