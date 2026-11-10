import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  FunnelSection,
  GradingSection,
  ImprovementSection,
  ModulesSection,
  PeopleSection,
  SkillsSection,
  StopsSection,
} from "@/components/cad-champions/admin/insights/sections";
import { RangeForm } from "@/components/cad-champions/admin/insights/range-form";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { parseInsightRange } from "@/lib/cad-champions/admin/funnel";
import { loadInsights } from "@/lib/cad-champions/admin/insights-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Insights (Prompt 11 Step E): the evidence for the organizers. Admin only.
// ?from=&to= are Qatar days; the default is the last 12 weeks. The numbers
// are loaded by lib/cad-champions/admin/insights-server.ts (head counts and
// narrow selects); a section that fails shows "Not available".

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string | string[]; to?: string | string[] }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.insights" });
  return ccPageMetadata({ locale, path: "/admin/insights", title: t("meta.title") });
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CcAdminInsightsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/insights"));
  const t = await getTranslations({ locale, namespace: "CC.admin.insights" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const sp = await searchParams;
  const range = parseInsightRange(one(sp.from), one(sp.to));
  const loaded = await loadInsights(range);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />
      <RangeForm locale={locale} range={range} />

      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc(`errors.${loaded.reason === "unavailable" ? "unavailable" : "error"}`)} />
        )
      ) : (
        <>
          {loaded.partial ? (
            <Alert tone="warning" title={t("partial.title")}>
              {t("partial.body")}
            </Alert>
          ) : null}
          <FunnelSection data={loaded.data} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <StopsSection data={loaded.data} />
            <ImprovementSection data={loaded.data} />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SkillsSection data={loaded.data} labels={loaded.labels} />
            <ModulesSection data={loaded.data} labels={loaded.labels} />
          </div>
          <PeopleSection data={loaded.data} />
          <GradingSection data={loaded.data} />
        </>
      )}
    </div>
  );
}
