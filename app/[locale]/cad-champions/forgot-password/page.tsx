import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CcForgotPasswordForm } from "@/components/cad-champions/auth/password-reset";
import { PageHeader } from "@/components/cad-champions/ui";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ expired?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.auth" });
  return ccPageMetadata({ locale, path: "/forgot-password", title: t("forgot.title") });
}

export default async function CcForgotPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const { expired } = await searchParams;
  const t = await getTranslations({ locale, namespace: "CC.auth" });
  const turnstileEnabled = await turnstileEnabledForPages();

  return (
    <div className="container max-w-xl py-8 sm:py-12">
      <PageHeader title={t("forgot.title")} purpose={t("forgot.purpose")} />
      <div className="mt-8">
        <CcForgotPasswordForm locale={locale} expired={expired === "1"} turnstileEnabled={turnstileEnabled} />
      </div>
    </div>
  );
}
