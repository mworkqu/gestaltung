import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ReviewWorkspace } from "@/components/cad-champions/review/review-workspace";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { aiConfigured } from "@/lib/cad-champions/drawing/ai-check";
import { loadReviewItem } from "@/lib/cad-champions/drawing/review-server";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Trainer review screen (Prompt 8 Step D). Staff only. Drawing viewer on one
// side, the rubric panel on the other (AI status / confidence / evidence
// prefilled), comment with machine translation, native files, Finalize.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; taskResultId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, taskResultId } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.review.screen" });
  return ccPageMetadata({ locale, path: `/admin/review/${taskResultId}`, title: t("metaTitle") });
}

export default async function CcAdminReviewItemPage({ params }: Props) {
  const { locale, taskResultId } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcStaff(locale, ccPath(locale, `/admin/review/${taskResultId}`));
  const t = await getTranslations({ locale, namespace: "CC.review.screen" });

  const back = (
    <Link href={ccPath(locale, "/admin/review")} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
      {t("back")}
    </Link>
  );

  const loaded = await loadReviewItem(taskResultId, locale);
  if (!loaded.ok) {
    return (
      <div className="container space-y-6 py-8 sm:py-12">
        {back}
        <Alert tone={loaded.reason === "not_found" ? "warning" : loaded.reason === "not_set_up" ? "info" : "error"} title={t(`problem.${loaded.reason}.title`)}>
          {t(`problem.${loaded.reason}.body`)}
        </Alert>
        <SignedInExtras pageName="admin-review-item" />
      </div>
    );
  }
  const v = loaded.view;

  return (
    <div className="container space-y-6 py-8 sm:py-12">
      {back}
      <PageHeader
        title={t("title", { task: v.taskTitle })}
        purpose={t("purpose")}
        actions={v.total > 0 && v.position > 0 ? <StatusChip tone="neutral">{t("position", { n: formatNumber(v.position, locale), total: formatNumber(v.total, locale) })}</StatusChip> : undefined}
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="tile">
          <dt className="text-xs text-body">{t("student")}</dt>
          <dd className="font-semibold text-ink">{v.studentName || t("unknownStudent")}</dd>
        </div>
        <div className="tile">
          <dt className="text-xs text-body">{t("test")}</dt>
          <dd className="font-semibold text-ink">{v.testTitle}</dd>
        </div>
        <div className="tile">
          <dt className="text-xs text-body">{t("submitted")}</dt>
          <dd className="font-semibold text-ink">{v.submittedAt ? formatDateTime(v.submittedAt, locale) : ""}</dd>
        </div>
        <div className="tile">
          <dt className="text-xs text-body">{t("aiTitle")}</dt>
          <dd className="font-semibold text-ink">
            {v.summary
              ? t("aiSummary", { pass: formatNumber(v.summary.pass, locale), total: formatNumber(v.summary.total, locale), flagged: formatNumber(v.summary.flagged, locale) })
              : v.gradingMode === "ai_drawing"
                ? t(`aiSkipped.${v.aiSkipped ?? "pending"}`)
                : t("aiNone")}
          </dd>
        </div>
      </dl>
      {v.finalized ? <Alert tone="info" title={t("finalizedTitle")}>{t("finalizedBody")}</Alert> : null}
      <ReviewWorkspace view={v} aiAvailable={aiConfigured()} />
      <SignedInExtras pageName="admin-review-item" />
    </div>
  );
}
