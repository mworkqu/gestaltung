import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

import { ConfirmEmailForm } from "@/components/auth/confirm-email-form";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { parseConfirmType, parseTokenHash } from "@/lib/auth/reset-token";

// Where the confirm-signup and change-email links land. Reads the query, so
// per-request, and — like /reset-password — makes NO Supabase call on the GET:
// mail-security scanners open every link in an incoming message, and the token
// is single-use (docs/AUTH_EMAILS.md).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return pageMetadata({ locale, path: "/confirm-email", title: `${t("confirmHeading")} | Gestaltung360`, noindex: true });
}

export default async function ConfirmEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;

  const tokenHash = parseTokenHash(query.token_hash);
  // Both templates name their type; an old link without one is a sign-up confirmation.
  const type = parseConfirmType(typeof query.type === "string" ? query.type : "signup");
  const next = typeof query.next === "string" ? query.next : null;

  return (
    <MessagesScope scope="auth">
      <ConfirmEmailForm tokenHash={tokenHash} type={type} next={next} />
    </MessagesScope>
  );
}
