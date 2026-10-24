import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { isResetType, parseTokenHash } from "@/lib/auth/reset-token";

// Reads the query, so per-request. NO Supabase call happens here: the emailed
// token is single-use and Microsoft 365 Safe Links, Mimecast and Proofpoint
// pre-fetch every link in an incoming message, which used to spend it before
// the person clicked. The hash is only put in a hidden field; the server action
// behind the Save button is what verifies it (docs/AUTH_EMAILS.md).
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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;

  // `type` is absent on an old link and "recovery" on the current template;
  // any other type is not a password reset and falls through to the code form.
  const type = typeof query.type === "string" ? query.type : "recovery";
  const tokenHash = isResetType(type) ? parseTokenHash(query.token_hash) : null;

  return (
    <MessagesScope scope="auth">
      <ResetPasswordForm tokenHash={tokenHash} />
    </MessagesScope>
  );
}
