"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";

import { searchHelpAction, type HelpSearchResponse } from "@/app/[locale]/cad-champions/help/actions";
import { Alert, Button, EmptyState, SkeletonCard } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

import { StillNeedHelpView } from "./still-need-help-view";

// Help Center search box + results. The /help page itself is prerendered (the
// category list), so ?q= is read here in the browser and answered by
// searchHelpAction. With no query this renders exactly what the Suspense
// fallback renders, so a plain visit has no layout jump. The search form stays
// a plain GET to /help?q=.

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

type Props = {
  locale: Locale;
  /** Setup notice (server-rendered; shown when the help table is missing). */
  notice: React.ReactNode;
  /** The category cards (server-rendered, static). */
  categories: React.ReactNode;
  /** Title used in the "still need help" message when there is no query. */
  pageTitle: string;
  whatsappNumber: string | null;
  supportEmail: string;
};

type Search = { status: "idle" } | { status: "loading" } | { status: "done"; res: HelpSearchResponse };

export function HelpSearch(props: Props) {
  return (
    <React.Suspense fallback={<HelpSearchView {...props} rawQuery="" search={{ status: "idle" }} />}>
      <HelpSearchWithQuery {...props} />
    </React.Suspense>
  );
}

function HelpSearchWithQuery(props: Props) {
  const rawQuery = (useSearchParams().get("q") ?? "").trim().slice(0, 80);
  const [search, setSearch] = React.useState<Search>(rawQuery ? { status: "loading" } : { status: "idle" });
  const { locale } = props;

  React.useEffect(() => {
    if (!rawQuery) {
      setSearch({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSearch({ status: "loading" });
    searchHelpAction(rawQuery, locale)
      .then((res) => {
        if (!cancelled) setSearch({ status: "done", res });
      })
      .catch(() => {
        if (!cancelled) setSearch({ status: "done", res: { ok: false, q: rawQuery } });
      });
    return () => {
      cancelled = true;
    };
  }, [rawQuery, locale]);

  return <HelpSearchView {...props} rawQuery={rawQuery} search={search} />;
}

function HelpSearchView({
  locale,
  notice,
  categories,
  pageTitle,
  whatsappNumber,
  supportEmail,
  rawQuery,
  search,
}: Props & { rawQuery: string; search: Search }) {
  const t = useTranslations("CC.help");
  const done = search.status === "done" ? search.res : null;
  const q = done ? done.q : rawQuery;
  const hasQuery = Boolean(rawQuery) && (done ? Boolean(done.q) : true);
  const noResults = Boolean(done && done.ok && done.q && done.results.length === 0);

  return (
    <>
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
            defaultValue={rawQuery}
            maxLength={80}
            placeholder={t("searchPlaceholder")}
            className={cn("neu-inset min-h-[44px] min-w-0 flex-1 px-4 text-base text-ink placeholder:text-mutedtext", ring)}
          />
          <Button type="submit" className="shrink-0">
            {t("searchButton")}
          </Button>
        </div>
      </form>

      {notice}

      {hasQuery && search.status === "loading" ? (
        <div aria-busy="true" className="grid gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {done && done.q ? (
        !done.ok ? (
          <Alert tone="warning" title={t("searchFailedTitle")}>
            {t("searchFailedBody")}
          </Alert>
        ) : done.results.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t("noResultsTitle")}
            description={t("noResultsBody", { query: q })}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href={ccPath(locale, "/help")}>{t("noResultsAction")}</Link>
              </Button>
            }
          />
        ) : (
          <section aria-label={t("resultsHeading", { query: q })} className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-extrabold text-heading">{t("resultsHeading", { query: q })}</h2>
              <p className="text-sm text-mutedtext">{t("resultsCount", { count: done.results.length })}</p>
            </div>
            <ul className="space-y-3">
              {done.results.map((r) => (
                <li key={r.slug}>
                  <Link href={ccPath(locale, `/help/${r.slug}`)} className={cn("neu neu-hover block p-5 hover:text-accent", ring)}>
                    <span className="block text-base font-bold text-ink">{r.title}</span>
                    {r.snippet ? <span className="mt-1 block text-sm text-body">{r.snippet}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      ) : null}

      {noResults ? (
        <StillNeedHelpView t={t} topic={q} whatsappNumber={whatsappNumber} supportEmail={supportEmail} />
      ) : null}

      {!noResults ? (
        <section aria-labelledby="cc-help-cats" className="space-y-4">
          <h2 id="cc-help-cats" className="text-2xl font-extrabold text-heading">
            {hasQuery ? t("allTopics") : t("categoriesHeading")}
          </h2>
          {categories}
        </section>
      ) : null}

      {!hasQuery ? (
        <StillNeedHelpView t={t} topic={pageTitle} whatsappNumber={whatsappNumber} supportEmail={supportEmail} />
      ) : null}
    </>
  );
}
