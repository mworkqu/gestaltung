import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { hasAccount } from "@/lib/auth/guest-redirect";
import { dashboardPathForRole } from "@/lib/auth/redirects";
import { safeNextPath } from "@/lib/auth/next-path";
import { SignInForm } from "@/components/auth/sign-in-form";
import { metaFor } from "@/lib/meta";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";
import { getEnabledProviders } from "@/lib/auth/providers-server";
import { oauthErrorProvider } from "@/lib/auth/providers";

// Reads the session cookie to redirect already-signed-in users; keep per-request.
export const dynamic = "force-dynamic";

export const generateMetadata = metaFor("signIn");

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[]; oauth_error?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // W1: where to come back to (a Studio step, …); validated, else the dashboard.
  const query = await searchParams;
  const next = safeNextPath(query.next, locale);
  // A social sign-in that came back with an error (/api/auth/callback).
  const oauthError = oauthErrorProvider(query.oauth_error);

  // Already signed in? Skip the form.
  // A guest (anonymous session) is not signed in: they still get the form.
  const user = await getAuthUser();
  const session = hasAccount(user) ? await getSessionContext(user) : null;
  if (session) {
    redirect(next ?? `/${locale}${dashboardPathForRole(session.profile.role)}`);
  }

  const [turnstileEnabled, providers] = await Promise.all([turnstileEnabledForPages(), getEnabledProviders()]);

  return (
    <MessagesScope scope="auth">
      <SignInForm next={next} turnstileEnabled={turnstileEnabled} providers={providers} oauthError={oauthError} />
    </MessagesScope>
  );
}
