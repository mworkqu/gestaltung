import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { HelpArticleForm } from "@/components/cad-champions/admin/help/article-form";
import { HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { loadHelpSlugs } from "@/lib/cad-champions/admin/help-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// New Help Center article (Prompt 11).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.help" });
  return ccPageMetadata({ locale, path: "/admin/help/new", title: t("new") });
}

export default async function CcAdminHelpNewPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/help/new"));
  const t = await getTranslations({ locale, namespace: "CC.admin.help" });
  const back = ccPath(locale, "/admin/help");
  const slugs = await loadHelpSlugs();
  return (
    <div className="page-stack">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("backToList")}
      </Link>
      <PageHeader title={t("new")} purpose={t("form.purposeNew")} help={<HelpTip label={t("helpLabel")}>{t("form.help")}</HelpTip>} />
      <HelpArticleForm article={null} backHref={back} allSlugs={slugs} />
    </div>
  );
}
