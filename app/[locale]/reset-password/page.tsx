import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { MessagesScope } from "@/components/i18n/messages-scope";

// Needs the recovery session cookie set by /api/auth/callback; per-request.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return pageMetadata({ locale, path: "/reset-password", title: `${t("resetHeading")} | Gestaltung360`, noindex: true });
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // A real (non-guest) session is required: the recovery link signs the user in.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasSession = !!user && user.is_anonymous !== true;

  return (
    <MessagesScope scope="auth">
      <ResetPasswordForm hasSession={hasSession} />
    </MessagesScope>
  );
}
