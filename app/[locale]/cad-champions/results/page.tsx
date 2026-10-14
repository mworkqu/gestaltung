import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ClipboardList } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { loadUserAttempts } from "@/lib/cad-champions/scoring/load";

// The signed-in student's results, newest first (Prompt 7). Each row opens
// /results/[attemptId].

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.results.list" });
  return ccPageMetadata({ locale, path: "/results", title: t("title") });
}

const TONE: Record<string, ChipTone> = { submitted: "info", grading: "info", provisional: "warning", graded: "success", expired: "neutral" };

export default async function CcResultsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, "/results"));
  const t = await getTranslations({ locale, namespace: "CC.results.list" });
  const tBand = await getTranslations({ locale, namespace: "CC.results.band" });
  const res = await loadUserAttempts(cc.user.id, locale);

  return (
    <div className="container space-y-6 py-8 sm:py-12">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />
      <div className="max-w-3xl">
        {!res.ok ? (
          <Alert tone="warning" title={t("loadErrorTitle")}>
            {t("loadError")}
          </Alert>
        ) : res.items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("emptyTitle")}
            description={t("emptyText")}
            action={
              <Button asChild>
                <Link href={ccPath(locale, "/test")}>{t("emptyCta")}</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {res.items.map((a) => (
              <li key={a.id} className="neu flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-base font-extrabold text-heading">{a.testTitle}</p>
                  <p className="text-xs text-body">{t("takenOn", { date: formatDate(a.submittedAt ?? a.startedAt, locale) })}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={TONE[a.status] ?? "neutral"}>{t(`status.${a.status}`)}</StatusChip>
                    {a.band && (a.status === "graded" || a.status === "provisional") ? <StatusChip tone="info">{tBand(`${a.band}.name`)}</StatusChip> : null}
                  </div>
                  {a.status === "expired" && a.retakeAt && a.retakeAt > Date.now() ? (
                    <p className="text-xs text-mutedtext">{t("retakeOn", { date: formatDate(a.retakeAt, locale) })}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {a.percent != null && (a.status === "graded" || a.status === "provisional") ? (
                    <span className="text-2xl font-extrabold text-heading">
                      <Ltr>{`${formatNumber(Math.round(a.percent), locale)}%`}</Ltr>
                    </span>
                  ) : null}
                  <Button asChild variant="secondary" size="sm">
                    <Link href={ccPath(locale, `/results/${a.id}`)}>
                      {t("open")}
                      <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
