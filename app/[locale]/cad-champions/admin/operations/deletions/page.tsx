import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DeletionList } from "@/components/cad-champions/admin/operations/deletion-list";
import { OpsTabs } from "@/components/cad-champions/admin/operations/ops-tabs";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { sortDeletionRequests } from "@/lib/cad-champions/admin/deletion";
import { loadDeletionRequests } from "@/lib/cad-champions/admin/deletion-server";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Account deletion requests (Prompt 11 Step F). Admin only. Pending first,
// then processed. Approving anonymises the profile and deletes the stored
// files (see lib/cad-champions/admin/deletion-server.ts).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.operations" });
  return ccPageMetadata({ locale, path: "/admin/operations/deletions", title: t("deletions.title") });
}

export default async function CcAdminDeletionsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/operations/deletions"));
  const t = await getTranslations({ locale, namespace: "CC.admin.operations.deletions" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });

  const db = adminDb();
  const loaded = db ? await loadDeletionRequests(db) : null;
  const sorted = loaded?.ok ? sortDeletionRequests(loaded.rows) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("title")}>{t("help")}</HelpTip>} />
      <OpsTabs locale={locale} active="deletions" />
      {!db ? (
        <Alert tone="error" title={tc("errors.unavailable")} />
      ) : !loaded || !loaded.ok ? (
        <Alert tone={loaded && loaded.reason === "not_set_up" ? "info" : "error"} title={tc(`errors.${loaded && loaded.reason === "not_set_up" ? "not_set_up" : "error"}`)} />
      ) : (
        <DeletionList pending={sorted.filter((r) => r.status === "pending")} processed={sorted.filter((r) => r.status !== "pending")} />
      )}
    </div>
  );
}
