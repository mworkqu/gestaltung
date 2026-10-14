import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { HealthGroups } from "@/components/cad-champions/admin/health/health-groups";
import { Alert, EmptyState, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { loadContentHealth } from "@/lib/cad-champions/admin/health-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Content health (Prompt 11 Step C): everything incomplete, each with a
// direct edit link. Admin only. The scan reads the content tables and the
// CC message trees of both languages (lib/cad-champions/admin/health-server.ts).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.health" });
  return ccPageMetadata({ locale, path: "/admin/health", title: t("meta.title") });
}

export default async function CcAdminHealthPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/health"));
  const t = await getTranslations({ locale, namespace: "CC.admin.health" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const health = await loadContentHealth();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />

      {!health.ok ? (
        health.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : health.reason === "unavailable" ? (
          <Alert tone="error" title={tc("errors.unavailable")} />
        ) : (
          <Alert tone="error" title={t("loadFailed.title")}>
            {t("loadFailed.body")}
          </Alert>
        )
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-body">
              <span className="font-bold text-heading">{t("summary", { count: formatNumber(health.total, locale) })}</span>
              <span className="ms-2 text-mutedtext">{t("checked", { time: formatDateTime(health.checkedAt, locale) })}</span>
            </p>
            <Link
              href={ccPath(locale, "/admin/health")}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-white/60 bg-surface px-5 text-sm font-semibold text-ink shadow-neu-sm hover:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <RefreshCw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {t("recheck")}
            </Link>
          </div>
          {health.total === 0 ? <EmptyState icon={CheckCircle2} title={t("allGood.title")} description={t("allGood.body")} /> : null}
          <HealthGroups groups={health.groups} />
        </>
      )}
    </div>
  );
}
