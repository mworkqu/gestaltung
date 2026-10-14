import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Inbox, MessageCircleQuestion } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { QuestionCard } from "@/components/cad-champions/review/question-card";
import { Alert, EmptyState, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { loadQuestions } from "@/lib/cad-champions/questions/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Questions inbox (Prompt 8 Step E). Staff only. Grade queries ("Question
// this result") and lesson questions in one list; reply emails the student.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; kind?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.review.questions" });
  return ccPageMetadata({ locale, path: "/admin/questions", title: t("metaTitle") });
}

export default async function CcAdminQuestionsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcStaff(locale, ccPath(locale, "/admin/questions"));
  const t = await getTranslations({ locale, namespace: "CC.review.questions" });
  const sp = await searchParams;
  const status = sp.status === "open" || sp.status === "answered" ? sp.status : null;
  const kind = sp.kind === "grade_query" || sp.kind === "lesson" ? sp.kind : null;
  const loaded = await loadQuestions(locale, { status, kind });
  const filtered = !!status || !!kind;
  const openCount = loaded.ok ? loaded.items.filter((q) => q.status === "open").length : 0;

  const selectCls = "min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              {t("filterStatus")}
              <select name="status" defaultValue={status ?? ""} className={selectCls}>
                <option value="">{t("all")}</option>
                <option value="open">{t("status.open")}</option>
                <option value="answered">{t("status.answered")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              {t("filterKind")}
              <select name="kind" defaultValue={kind ?? ""} className={selectCls}>
                <option value="">{t("all")}</option>
                <option value="grade_query">{t("kind.grade_query")}</option>
                <option value="lesson">{t("kind.lesson")}</option>
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
                {t("apply")}
              </button>
              {filtered ? (
                <Link href={ccPath(locale, "/admin/questions")} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink hover:bg-panel">
                  {t("clear")}
                </Link>
              ) : null}
            </div>
          </form>

          {loaded.items.length === 0 ? (
            <EmptyState icon={filtered ? Inbox : MessageCircleQuestion} title={filtered ? t("emptyFiltered.title") : t("empty.title")} description={filtered ? t("emptyFiltered.body") : t("empty.body")} />
          ) : (
            <section aria-labelledby="cc-questions-list" className="space-y-4">
              <h2 id="cc-questions-list" className="text-lg font-extrabold text-heading">
                {t("count", { open: formatNumber(openCount, locale), total: formatNumber(loaded.items.length, locale) })}
              </h2>
              {loaded.items.map((q) => (
                <QuestionCard key={q.id} q={q} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
