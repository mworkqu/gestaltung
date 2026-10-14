import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AnnouncementComposer } from "@/components/cad-champions/admin/operations/announcement-composer";
import { AnnouncementHistory } from "@/components/cad-champions/admin/operations/announcement-history";
import { OpsTabs } from "@/components/cad-champions/admin/operations/ops-tabs";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { loadAnnouncements } from "@/lib/cad-champions/admin/announcements-server";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { institutionsOf } from "@/lib/cad-champions/admin/students";
import { loadStudentRows } from "@/lib/cad-champions/admin/students-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Operations: announcements (Prompt 11 Step F). Admin only. Compose a
// bilingual email, pick the students with the Students filters, preview it,
// send a test to yourself, confirm the recipient count, then send in batches.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.operations" });
  return ccPageMetadata({ locale, path: "/admin/operations", title: t("announcements.title") });
}

export default async function CcAdminOperationsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcAdmin(locale, ccPath(locale, "/admin/operations"));
  const t = await getTranslations({ locale, namespace: "CC.admin.operations.announcements" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });

  const db = adminDb();
  const [students, history] = db ? await Promise.all([loadStudentRows(db), loadAnnouncements(db)]) : [null, null];
  const institutions = students?.ok ? institutionsOf(students.rows) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("title")}>{t("help")}</HelpTip>} />
      <OpsTabs locale={locale} active="announcements" />

      {!db ? (
        <Alert tone="error" title={tc("errors.unavailable")} />
      ) : history && !history.ok && history.reason === "not_set_up" ? (
        <Alert tone="info" title={tc("notSetUp.title")}>
          {tc("notSetUp.body")}
        </Alert>
      ) : (
        <>
          {students && !students.ok ? <Alert tone={students.reason === "not_set_up" ? "info" : "error"} title={tc(`errors.${students.reason === "not_set_up" ? "not_set_up" : "error"}`)} /> : null}
          <AnnouncementComposer institutions={institutions} adminEmail={cc.user.email ?? null} />
          <section aria-labelledby="history-heading" className="space-y-3">
            <h2 id="history-heading" className="title-section">
              {t("history.heading")}
            </h2>
            {history && history.ok ? <AnnouncementHistory rows={history.rows} /> : <Alert tone="error" title={tc("errors.error")} />}
          </section>
        </>
      )}
    </div>
  );
}
