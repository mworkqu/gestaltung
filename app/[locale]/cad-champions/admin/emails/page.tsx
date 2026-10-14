import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EmailPreviewList } from "@/components/cad-champions/admin/emails/email-preview-list";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { AUTH_TEMPLATE_FILES, listEmailTemplates } from "@/lib/cad-champions/admin/email-templates";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Email templates (Prompt 11 Step F). Admin only. Every bilingual email the
// app sends, previewed with sample data; "Send test to me" goes only to the
// admin's own address.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.emails" });
  return ccPageMetadata({ locale, path: "/admin/emails", title: t("title") });
}

export default async function CcAdminEmailsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcAdmin(locale, ccPath(locale, "/admin/emails"));
  const t = await getTranslations({ locale, namespace: "CC.admin.emails" });

  const items = listEmailTemplates().map((d) => ({ id: d.id, group: d.group, localeAware: d.localeAware, ownerOnly: d.ownerOnly, bilingual: d.bilingual }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("title")}>{t("help")}</HelpTip>} />
      <Alert tone="info" title={t("auth.title")}>
        <p>{t("auth.body")}</p>
        <ul className="mt-2 list-disc space-y-1 ps-5">
          {AUTH_TEMPLATE_FILES.map((f) => (
            <li key={f}>
              <Ltr as="code">{f}</Ltr>
            </li>
          ))}
        </ul>
      </Alert>
      <EmailPreviewList items={items} adminEmail={cc.user.email ?? null} />
    </div>
  );
}
