import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { HelpArticleForm } from "@/components/cad-champions/admin/help/article-form";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { helpfulStats } from "@/lib/cad-champions/admin/help";
import { loadHelpArticle, loadHelpSlugs } from "@/lib/cad-champions/admin/help-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// Edit one Help Center article (Prompt 11).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.help" });
  return ccPageMetadata({ locale, path: `/admin/help/${id}`, title: t("form.pageTitle") });
}

export default async function CcAdminHelpEditPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, `/admin/help/${id}`));
  const t = await getTranslations({ locale, namespace: "CC.admin.help" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadHelpArticle(id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  const slugs = loaded.ok ? (await loadHelpSlugs()).filter((s) => s !== loaded.data.slug) : [];
  const back = ccPath(locale, "/admin/help");
  const stats = loaded.ok ? helpfulStats(loaded.data.helpful_yes, loaded.data.helpful_no) : null;

  return (
    <div className="page-stack">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("backToList")}
      </Link>
      <PageHeader
        title={loaded.ok ? pick(locale as Locale, loaded.data.title_en, loaded.data.title_ar) : t("form.pageTitle")}
        purpose={t("form.purposeEdit")}
        help={<HelpTip label={t("helpLabel")}>{t("form.help")}</HelpTip>}
      />
      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc("errors.error")} />
        )
      ) : (
        <>
          {stats ? (
            <p className="text-sm text-body">
              {stats.total === 0
                ? t("form.noVotes")
                : t("form.votes", { yes: formatNumber(stats.yes, locale as Locale), no: formatNumber(stats.no, locale as Locale), percent: formatNumber(stats.percent ?? 0, locale as Locale) })}
            </p>
          ) : null}
          <HelpArticleForm article={loaded.data} backHref={back} allSlugs={slugs} />
        </>
      )}
    </div>
  );
}
