import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Inbox } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { loadReviewQueue, type QueueRow } from "@/lib/cad-champions/drawing/review-server";
import { isOverdue } from "@/lib/cad-champions/drawing/review";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Trainer review queue (Prompt 8 Step D). Staff only. Oldest first; filters
// by test and "unclear only". Each row opens the review screen.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ test?: string; unclear?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.review.queue" });
  return ccPageMetadata({ locale, path: "/admin/review", title: t("metaTitle") });
}

function waitingLabel(hours: number | null, locale: Locale, t: (k: string, v?: Record<string, string>) => string): string {
  if (hours == null) return "";
  const h = Math.floor(hours);
  if (h < 1) return t("waitingUnderHour");
  if (h < 48) return t("waitingHours", { hours: formatNumber(h, locale) });
  return t("waitingDays", { days: formatNumber(Math.floor(h / 24), locale), hours: formatNumber(h % 24, locale) });
}

export default async function CcAdminReviewQueuePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcStaff(locale, ccPath(locale, "/admin/review"));
  const t = await getTranslations({ locale, namespace: "CC.review.queue" });
  const sp = await searchParams;
  const testId = sp.test && /^[0-9a-f-]{36}$/i.test(sp.test) ? sp.test : null;
  const unclearOnly = sp.unclear === "1";

  const loaded = await loadReviewQueue(locale, { testId, unclearOnly });
  const filtered = !!testId || unclearOnly;

  return (
    <div className="container space-y-8 py-8 sm:py-12">
      <Link href={ccPath(locale, "/admin")} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />

      {!loaded.ok ? (
        <Alert tone={loaded.reason === "not_set_up" ? "info" : "error"} title={t(`problem.${loaded.reason}.title`)}>
          {t(`problem.${loaded.reason}.body`)}
        </Alert>
      ) : (
        <>
          <form method="get" className="neu flex flex-col gap-4 p-5 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-[14rem] flex-col gap-1 text-sm font-semibold text-ink">
              {t("filterTest")}
              <select name="test" defaultValue={testId ?? ""} className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <option value="">{t("allTests")}</option>
                {loaded.tests.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" name="unclear" value="1" defaultChecked={unclearOnly} className="h-5 w-5 accent-[var(--accent,#0e59c5)]" />
              {t("unclearOnly")}
              <HelpTip label={t("unclearHelpLabel")}>{t("unclearHelp")}</HelpTip>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
                {t("apply")}
              </button>
              {filtered ? (
                <Link href={ccPath(locale, "/admin/review")} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink hover:bg-panel">
                  {t("clear")}
                </Link>
              ) : null}
            </div>
          </form>

          {loaded.rows.length === 0 ? (
            <EmptyState icon={filtered ? Inbox : ClipboardCheck} title={filtered ? t("emptyFiltered.title") : t("empty.title")} description={filtered ? t("emptyFiltered.body") : t("empty.body")} />
          ) : (
            <section aria-labelledby="cc-queue-title" className="space-y-3">
              <h2 id="cc-queue-title" className="text-lg font-extrabold text-heading">
                {t("count", { count: formatNumber(loaded.rows.length, locale) })}
              </h2>
              <QueueTable rows={loaded.rows} locale={locale} />
            </section>
          )}
        </>
      )}
      <SignedInExtras pageName="admin-review" />
    </div>
  );
}

async function QueueTable({ rows, locale }: { rows: QueueRow[]; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.review.queue" });
  const tw = (k: string, v?: Record<string, string>) => t(k, v);
  return (
    <div className="neu overflow-x-auto p-2">
      <table className="w-full min-w-[46rem] text-start text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-body">
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colStudent")}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colTest")}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colSubmitted")}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colAi")}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colWaiting")}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">
              <span className="sr-only">{t("open")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const overdue = isOverdue(r.waitingHours);
            return (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-3 font-semibold text-ink">{r.studentName || t("unknownStudent")}</td>
                <td className="px-3 py-3 text-body">
                  <span className="block text-ink">{r.testTitle}</span>
                  <span className="block text-xs">{r.taskTitle}</span>
                </td>
                <td className="px-3 py-3 text-body">{r.submittedAt ? formatDateTime(r.submittedAt, locale) : ""}</td>
                <td className="px-3 py-3">
                  {r.kind !== "drawing" ? (
                    <StatusChip tone="neutral">{t(`kind.${r.kind}`)}</StatusChip>
                  ) : r.summary ? (
                    <span className="text-ink">
                      {t("aiSummary", { pass: formatNumber(r.summary.pass, locale), total: formatNumber(r.summary.total, locale) })}
                      {r.summary.flagged > 0 ? (
                        <span className="ms-1 font-semibold text-inventory">{t("aiUnclear", { count: formatNumber(r.summary.flagged, locale) })}</span>
                      ) : null}
                    </span>
                  ) : (
                    <StatusChip tone="warning">{t(`skipped.${r.aiSkipped ?? "pending"}`)}</StatusChip>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className={overdue ? "font-bold text-[#a1231f]" : "text-body"}>
                    {waitingLabel(r.waitingHours, locale, tw)}
                    {overdue ? <span className="sr-only"> {t("overdue")}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-3 text-end">
                  <Link
                    href={ccPath(locale, `/admin/review/${r.id}`)}
                    className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    {t("open")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
