import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CcResetPasswordForm } from "@/components/cad-champions/auth/password-reset";
import { PageHeader } from "@/components/cad-champions/ui";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.auth" });
  return ccPageMetadata({ locale, path: "/reset-password", title: t("reset.title") });
}

// Reached from the emailed reset link via /api/auth/callback?next=/cad-champions/{locale}/reset-password.
export default async function CcResetPasswordPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.auth" });

  return (
    <div className="container max-w-xl py-8 sm:py-12">
      <PageHeader title={t("reset.title")} purpose={t("reset.purpose")} />
      <div className="mt-8">
        <CcResetPasswordForm locale={locale} />
      </div>
    </div>
  );
}
