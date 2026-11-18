import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CcForgotPasswordWithParams } from "@/components/cad-champions/auth/forgot-password-with-params";
import { PageHeader } from "@/components/cad-champions/ui";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.auth" });
  return ccPageMetadata({ locale, path: "/forgot-password", title: t("forgot.title") });
}

export default async function CcForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.auth" });
  const turnstileEnabled = await turnstileEnabledForPages();

  return (
    <div className="container max-w-xl py-8 sm:py-12">
      <PageHeader title={t("forgot.title")} purpose={t("forgot.purpose")} />
      <div className="mt-8">
        <CcForgotPasswordWithParams locale={locale} turnstileEnabled={turnstileEnabled} />
      </div>
    </div>
  );
}
