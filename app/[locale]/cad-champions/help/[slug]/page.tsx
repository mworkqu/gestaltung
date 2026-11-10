import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { HelpfulVote } from "@/components/cad-champions/help/helpful-vote";
import { StillNeedHelp } from "@/components/cad-champions/help/still-need-help";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, Card, Term } from "@/components/cad-champions/ui";
import { GLOSSARY, type GlossaryId } from "@/lib/cad-champions/glossary";
import { getHelpCategory } from "@/lib/cad-champions/help/categories";
import { getHelpArticle, listHelpArticles } from "@/lib/cad-champions/help/search";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string; slug: string }> };

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const res = await getHelpArticle(slug, locale);
  if (!res.ok || !res.data) return {};
  return ccPageMetadata({ locale, path: `/help/${slug}`, title: res.data.title });
}

export default async function CcHelpArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "CC.help" });
  const res = await getHelpArticle(slug, locale);

  // Before the migration (table missing): a friendly state, never a crash.
  if (!res.ok) {
    return (
      <div className="container max-w-3xl space-y-6 py-8 sm:py-12">
        <Alert
          tone="info"
          title={t("articleSetupTitle")}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={ccPath(locale, "/help")}>{t("backToHelp")}</Link>
            </Button>
          }
        >
          {t("articleSetupBody")}
        </Alert>
        <SignedInExtras pageName={t("backToHelp")} />
      </div>
    );
  }
  if (!res.data) notFound();
  const article = res.data;

  // Related: same category, up to 4 (the article's own related_slugs first).
  const list = await listHelpArticles(locale);
  const siblings = list.ok ? list.data.filter((a) => a.slug !== slug) : [];
  const explicit = article.relatedSlugs
    .map((s) => siblings.find((a) => a.slug === s))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const sameCategory = siblings.filter((a) => a.category && a.category === article.category);
  const related = [...explicit, ...sameCategory.filter((a) => !explicit.includes(a))].slice(0, 4);

  const glossaryIds = article.glossaryTerms.filter((id): id is GlossaryId => id in GLOSSARY);
  const category = article.category ? getHelpCategory(article.category) : null;

  return (
    <div className="container max-w-3xl space-y-8 py-8 sm:py-12">
      <nav aria-label={t("backToHelp")}>
        <Link
          href={ccPath(locale, "/help")}
          className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-full text-sm font-semibold text-accent hover:text-cobalt-hover", ring)}
        >
          <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
          {t("backToHelp")}
        </Link>
      </nav>

      <header>
        {category ? <p className="kicker">{t(category.titleKey)}</p> : null}
        <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight text-heading rtl:tracking-normal sm:text-4xl">
          {article.title}
        </h1>
      </header>

      <Card as="article" className="p-5 sm:p-8">
        <ArticleBody markdown={article.body} locale={locale} hasVideoId={Boolean(article.videoId)} />
      </Card>

      {glossaryIds.length > 0 ? (
        <section aria-labelledby="cc-help-gloss" className="space-y-3">
          <h2 id="cc-help-gloss" className="text-lg font-bold text-heading">
            {t("glossaryHeading")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {glossaryIds.map((id) => (
              <li key={id} className="tile min-h-[44px] !py-2.5 text-sm">
                <Term id={id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card as="section" className="p-5 sm:p-6">
        <HelpfulVote slug={slug} />
      </Card>

      {related.length > 0 ? (
        <section aria-labelledby="cc-help-related" className="space-y-3">
          <h2 id="cc-help-related" className="text-lg font-bold text-heading">
            {t("relatedHeading")}
          </h2>
          <ul className="space-y-2">
            {related.map((a) => (
              <li key={a.slug}>
                <Link
                  href={ccPath(locale, `/help/${a.slug}`)}
                  className={cn("neu neu-hover block px-5 py-3 text-base font-semibold text-ink hover:text-accent", ring)}
                >
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <StillNeedHelp locale={locale} topic={article.title} title={t("stillStuckTitle")} body={t("stillStuckBody")} />

      <SignedInExtras pageName={article.title} />
    </div>
  );
}
