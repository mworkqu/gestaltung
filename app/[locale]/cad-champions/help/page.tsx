import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { SearchX, Search } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Alert, Button, Card, EmptyState, PageHeader } from "@/components/cad-champions/ui";
import { StillNeedHelp } from "@/components/cad-champions/help/still-need-help";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { HELP_CATEGORIES } from "@/lib/cad-champions/help/categories";
import {
  listHelpArticles,
  logHelpSearch,
  sanitizeHelpQuery,
  searchHelpArticles,
  type HelpArticleLink,
  type HelpSearchResult,
} from "@/lib/cad-champions/help/search";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

export const generateMetadata = placeholderMetadata("help", "/help");

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export default async function CcHelpPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "CC.help" });
  const tp = await getTranslations({ locale, namespace: "CC.pages" });
  const raw = (await searchParams).q;
  const q = sanitizeHelpQuery(Array.isArray(raw) ? raw[0] : raw);

  const [list, search, user] = await Promise.all([
    listHelpArticles(locale),
    q ? searchHelpArticles(q, locale) : Promise.resolve(null),
    getCcUser(),
  ]);

  // Log the search after the response is sent; never blocks or breaks rendering.
  if (q && search?.ok) {
    const resultsCount = search.data.length;
    const userId = user?.user.id ?? null;
    try {
      after(() => logHelpSearch({ query: q, locale, resultsCount, userId }));
    } catch {
      void logHelpSearch({ query: q, locale, resultsCount, userId });
    }
  }

  const articles: HelpArticleLink[] = list.ok ? list.data : [];
  const byCategory = new Map<string, HelpArticleLink[]>();
  for (const a of articles) {
    if (!a.category) continue;
    byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  }

  return (
    <div className="container space-y-8 py-8 sm:space-y-10 sm:py-12">
      <PageHeader title={tp("help.title")} purpose={tp("help.purpose")} />

      <form method="get" action={ccPath(locale, "/help")} role="search" className="neu space-y-3 p-5 sm:p-6">
        <label htmlFor="cc-help-q" className="flex items-center gap-2 text-sm font-bold text-ink">
          <Search aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
          {t("searchLabel")}
        </label>
        <div className="flex gap-2">
          <input
            id="cc-help-q"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={80}
            placeholder={t("searchPlaceholder")}
            className={cn("neu-inset min-h-[44px] min-w-0 flex-1 px-4 text-base text-ink placeholder:text-mutedtext", ring)}
          />
          <Button type="submit" className="shrink-0">
            {t("searchButton")}
          </Button>
        </div>
      </form>

      {!list.ok ? (
        <Alert tone="info" title={t("setupTitle")}>
          {t("setupBody")}
        </Alert>
      ) : null}

      {q ? (
        <SearchResults
          locale={locale}
          results={search?.ok ? search.data : []}
          failed={search ? !search.ok : false}
          labels={{
            heading: t("resultsHeading", { query: q }),
            count: (n) => t("resultsCount", { count: n }),
            noTitle: t("noResultsTitle"),
            noBody: t("noResultsBody", { query: q }),
            noAction: t("noResultsAction"),
            failTitle: t("searchFailedTitle"),
            failBody: t("searchFailedBody"),
          }}
        />
      ) : null}

      {q && search?.ok && search.data.length === 0 ? (
        <StillNeedHelp locale={locale} topic={q} />
      ) : null}

      {!q || !(search?.ok && search.data.length === 0) ? (
        <section aria-labelledby="cc-help-cats" className="space-y-4">
          <h2 id="cc-help-cats" className="text-2xl font-extrabold text-heading">
            {q ? t("allTopics") : t("categoriesHeading")}
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {HELP_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const items = byCategory.get(cat.id) ?? [];
              return (
                <Card as="section" key={cat.id} className="flex flex-col gap-4 p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-neu-sm">
                      <Icon aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="title-card">{t(cat.titleKey)}</h3>
                      <p className="mt-0.5 text-sm text-body">{t(cat.descriptionKey)}</p>
                      {list.ok ? (
                        <p className="mt-1 text-xs font-semibold text-mutedtext">{t("articleCount", { count: items.length })}</p>
                      ) : null}
                    </div>
                  </div>
                  {list.ok && items.length === 0 ? (
                    <p className="text-sm text-mutedtext">{t("emptyCategory")}</p>
                  ) : null}
                  {items.length > 0 ? (
                    <ul className="space-y-1">
                      {items.map((a) => (
                        <li key={a.slug}>
                          <Link
                            href={ccPath(locale, `/help/${a.slug}`)}
                            className={cn(
                              "flex min-h-[44px] items-center rounded-xl px-3 text-sm font-semibold text-ink hover:bg-panel hover:text-accent",
                              ring
                            )}
                          >
                            {a.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {!q ? <StillNeedHelp locale={locale} topic={tp("help.title")} /> : null}

      <SignedInExtras pageName={tp("help.title")} />
    </div>
  );
}

function SearchResults({
  locale,
  results,
  failed,
  labels,
}: {
  locale: "en" | "ar";
  results: HelpSearchResult[];
  failed: boolean;
  labels: {
    heading: string;
    count: (n: number) => string;
    noTitle: string;
    noBody: string;
    noAction: string;
    failTitle: string;
    failBody: string;
  };
}) {
  if (failed) {
    return (
      <Alert tone="warning" title={labels.failTitle}>
        {labels.failBody}
      </Alert>
    );
  }
  if (results.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={labels.noTitle}
        description={labels.noBody}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={ccPath(locale, "/help")}>{labels.noAction}</Link>
          </Button>
        }
      />
    );
  }
  return (
    <section aria-label={labels.heading} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-extrabold text-heading">{labels.heading}</h2>
        <p className="text-sm text-mutedtext">{labels.count(results.length)}</p>
      </div>
      <ul className="space-y-3">
        {results.map((r) => (
          <li key={r.slug}>
            <Link
              href={ccPath(locale, `/help/${r.slug}`)}
              className={cn("neu neu-hover block p-5 hover:text-accent", ring)}
            >
              <span className="block text-base font-bold text-ink">{r.title}</span>
              {r.snippet ? <span className="mt-1 block text-sm text-body">{r.snippet}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
