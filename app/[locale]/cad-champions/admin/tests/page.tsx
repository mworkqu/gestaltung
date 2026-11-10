import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SplitMeter } from "@/components/cad-champions/admin/tests/split-meter";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { loadTestList } from "@/lib/cad-champions/admin/test-builder-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Admin tests list (Prompt 11 Step B): every test with its type, upload mode,
// publish state, task count, points and measurement/judgement split.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.tests" });
  return ccPageMetadata({ locale, path: "/admin/tests", title: t("title") });
}

export default async function CcAdminTestsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/tests"));
  const t = await getTranslations({ locale, namespace: "CC.admin.tests" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadTestList();
  const n = (v: number) => formatNumber(v, locale as Locale, { maximumFractionDigits: 2 });
  const newLink = (
    <Button asChild>
      <Link href={ccPath(locale, "/admin/tests/new")}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        {t("new")}
      </Link>
    </Button>
  );

  return (
    <div className="page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} actions={newLink} />

      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone={loaded.reason === "unavailable" ? "warning" : "error"} title={tc(`errors.${loaded.reason === "unavailable" ? "unavailable" : "error"}`)} />
        )
      ) : loaded.rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("list.emptyTitle")} description={t("list.emptyBody")} action={newLink} />
      ) : (
        <div className="neu overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">{t("list.caption")}</caption>
              <thead>
                <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
                  <th scope="col" className="p-3 text-start font-semibold">{t("list.colTest")}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t("fields.type")}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t("fields.upload_mode")}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t("list.colStatus")}</th>
                  <th scope="col" className="p-3 text-end font-semibold">{t("list.colTasks")}</th>
                  <th scope="col" className="p-3 text-end font-semibold">{t("list.colPoints")}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t("list.colSplit")}</th>
                </tr>
              </thead>
              <tbody>
                {loaded.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <Link href={ccPath(locale, `/admin/tests/${r.slug}`)} className="inline-flex min-h-11 flex-col justify-center font-semibold text-accent underline-offset-2 hover:underline">
                        <span>{locale === "ar" ? r.title_ar || r.title_en : r.title_en}</span>
                        <Ltr className="text-xs font-normal text-mutedtext">{r.slug}</Ltr>
                      </Link>
                    </td>
                    <td className="p-3">{t(`types.${r.type}`)}</td>
                    <td className="p-3">{t(`uploadModes.${r.upload_mode}`)}</td>
                    <td className="p-3">
                      <span className="flex flex-wrap gap-1">
                        <StatusChip tone={r.is_published ? "success" : "neutral"}>{r.is_published ? tc("published") : tc("draft")}</StatusChip>
                        {r.admin_only ? <StatusChip tone="info">{t("list.staffOnly")}</StatusChip> : null}
                      </span>
                    </td>
                    <td className="p-3 text-end">{n(r.taskCount)}</td>
                    <td className="p-3 text-end">{n(r.points)}</td>
                    <td className="p-3">
                      <SplitMeter split={r.split} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
