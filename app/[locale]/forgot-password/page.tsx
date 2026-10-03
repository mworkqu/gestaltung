import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { MessagesScope } from "@/components/i18n/messages-scope";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return pageMetadata({ locale, path: "/forgot-password", title: `${t("forgotHeading")} | Gestaltung360`, noindex: true });
}

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ expired?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { expired } = await searchParams;

  return (
    <MessagesScope scope="auth">
      <ForgotPasswordForm expired={expired === "1"} />
    </MessagesScope>
  );
}
