import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LifeBuoy, Plus, SearchX, ThumbsUp } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { HelpArticlesTable } from "@/components/cad-champions/admin/help/articles-table";
import { Alert, Button, EmptyState, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { NO_RESULT_DAYS } from "@/lib/cad-champions/admin/help";
import { loadHelpArticles, loadNoResultSearches } from "@/lib/cad-champions/admin/help-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Admin Help Center (Prompt 11): the articles with their "Was this helpful?"
// votes, plus the searches that found nothing in the last 30 days (what to
// write next).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.help" });
  return ccPageMetadata({ locale, path: "/admin/help", title: t("title") });
}

export default async function CcAdminHelpPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/help"));
  const t = await getTranslations({ locale, namespace: "CC.admin.help" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const [articles, searches] = await Promise.all([loadHelpArticles(), loadNoResultSearches()]);
  const n = (v: number) => formatNumber(v, locale as Locale);

  return (
    <div className="page-stack">
      <PageHeader
        title={t("title")}
        purpose={t("purpose")}
        help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>}
        actions={
          <Button asChild>
            <Link href={ccPath(locale, "/admin/help/new")}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("new")}
            </Link>
          </Button>
        }
      />

      {!articles.ok ? (
        articles.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc("errors.error")} />
        )
      ) : (
        <>
          <section className="neu flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="helpful-stats">
            <h2 id="helpful-stats" className="title-card flex items-center gap-2">
              <ThumbsUp aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
              {t("stats.title")}
            </h2>
            {articles.data.totals.total === 0 ? (
              <p className="text-sm text-mutedtext">{t("stats.none")}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="tile">
                  <dt className="text-xs text-mutedtext">{t("stats.percent")}</dt>
                  <dd className="text-2xl font-extrabold text-heading">{n(articles.data.totals.percent ?? 0)}%</dd>
                </div>
                <div className="tile">
                  <dt className="text-xs text-mutedtext">{t("stats.yes")}</dt>
                  <dd className="text-2xl font-extrabold text-heading">{n(articles.data.totals.yes)}</dd>
                </div>
                <div className="tile">
                  <dt className="text-xs text-mutedtext">{t("stats.no")}</dt>
                  <dd className="text-2xl font-extrabold text-heading">{n(articles.data.totals.no)}</dd>
                </div>
                <div className="tile">
                  <dt className="text-xs text-mutedtext">{t("stats.articles")}</dt>
                  <dd className="text-2xl font-extrabold text-heading">{n(articles.data.articles.length)}</dd>
                </div>
              </dl>
            )}
            <p className="text-xs text-mutedtext">{t("stats.note")}</p>
          </section>

          {articles.data.articles.length === 0 ? (
            <EmptyState
              icon={LifeBuoy}
              title={t("list.emptyTitle")}
              description={t("list.emptyBody")}
              action={
                <Button asChild>
                  <Link href={ccPath(locale, "/admin/help/new")}>{t("new")}</Link>
                </Button>
              }
            />
          ) : (
            <HelpArticlesTable articles={articles.data.articles} />
          )}
        </>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="no-results">
        <div>
          <h2 id="no-results" className="title-section">
            {t("noResults.title")}
          </h2>
          <p className="mt-1 text-sm text-body">{t("noResults.purpose", { days: n(NO_RESULT_DAYS) })}</p>
        </div>
        {!searches.ok ? (
          searches.reason === "not_set_up" ? (
            <Alert tone="info" title={tc("notSetUp.title")}>
              {tc("notSetUp.body")}
            </Alert>
          ) : (
            <Alert tone="error" title={tc("errors.error")} />
          )
        ) : searches.data.length === 0 ? (
          <EmptyState icon={SearchX} title={t("noResults.emptyTitle")} description={t("noResults.emptyBody")} />
        ) : (
          <div className="neu overflow-x-auto p-0">
            <table className="w-full min-w-[32rem] text-start text-sm">
              <caption className="sr-only">{t("noResults.title")}</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("noResults.query")}
                  </th>
                  <th scope="col" className="p-3 text-end font-semibold">
                    {t("noResults.count")}
                  </th>
                  <th scope="col" className="p-3 text-end font-semibold">
                    {tc("english")}
                  </th>
                  <th scope="col" className="p-3 text-end font-semibold">
                    {tc("arabic")}
                  </th>
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("noResults.last")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {searches.data.map((s) => (
                  <tr key={s.query} className="border-b border-border last:border-b-0">
                    <td className="p-3 font-semibold text-heading">
                      <bdi>{s.query}</bdi>
                    </td>
                    <td className="p-3 text-end font-semibold">{n(s.count)}</td>
                    <td className="p-3 text-end">{n(s.en)}</td>
                    <td className="p-3 text-end">{n(s.ar)}</td>
                    <td className="whitespace-nowrap p-3 text-mutedtext">{formatDate(s.lastSearched, locale as Locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
