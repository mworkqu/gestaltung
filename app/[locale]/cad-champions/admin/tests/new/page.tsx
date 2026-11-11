import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { TestCreateForm } from "@/components/cad-champions/admin/tests/test-create-form";
import { HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// New test (Prompt 11 Step B): slug, titles EN + AR and type; the test page
// then takes the timing, rules, tasks and marking.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.tests" });
  return ccPageMetadata({ locale, path: "/admin/tests/new", title: t("create.title") });
}

export default async function CcAdminNewTestPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/tests/new"));
  const t = await getTranslations({ locale, namespace: "CC.admin.tests" });

  return (
    <div className="page-stack">
      <PageHeader title={t("create.title")} purpose={t("create.purpose")} help={<HelpTip label={t("create.helpLabel")}>{t("create.help")}</HelpTip>} />
      <TestCreateForm />
      <p className="text-sm">
        <Link href={ccPath(locale, "/admin/tests")} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-2 hover:underline">
          {t("backToList")}
        </Link>
      </p>
    </div>
  );
}
