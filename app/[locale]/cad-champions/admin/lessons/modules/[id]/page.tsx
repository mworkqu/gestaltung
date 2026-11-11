import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ModuleForm } from "@/components/cad-champions/admin/lessons/module-form";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { loadModule } from "@/lib/cad-champions/admin/lessons-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Edit one training module (Prompt 11): titles, descriptions, why it matters,
// skill area, competition module, icon, order, orientation and published.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  return ccPageMetadata({ locale, path: `/admin/lessons/modules/${id}`, title: t("module.title") });
}

export default async function CcAdminModulePage({ params }: Props) {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, `/admin/lessons/modules/${id}`));
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadModule(id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  const back = ccPath(locale, "/admin/lessons");

  return (
    <div className="page-stack">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("backToTree")}
      </Link>
      <PageHeader title={t("module.title")} purpose={t("module.purpose")} help={<HelpTip label={t("helpLabel")}>{t("module.help")}</HelpTip>} />
      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc("errors.error")} />
        )
      ) : (
        <ModuleForm module={loaded.data} backHref={back} />
      )}
    </div>
  );
}
