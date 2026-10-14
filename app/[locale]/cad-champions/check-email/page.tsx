import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CcCheckEmail } from "@/components/cad-champions/auth/check-email";
import { PageHeader } from "@/components/cad-champions/ui";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.auth" });
  return ccPageMetadata({ locale, path: "/check-email", title: t("checkEmail.title") });
}

export default async function CcCheckEmailPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.auth" });

  return (
    <div className="container max-w-xl py-8 sm:py-12">
      <PageHeader title={t("checkEmail.title")} purpose={t("checkEmail.purpose")} />
      <div className="mt-8">
        <CcCheckEmail locale={locale} />
      </div>
    </div>
  );
}
