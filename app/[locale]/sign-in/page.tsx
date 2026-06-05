import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { dashboardPathForRole } from "@/lib/auth/redirects";
import { SignInForm } from "@/components/auth/sign-in-form";

// Reads the session cookie to redirect already-signed-in users; keep per-request.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Already signed in? Skip the form.
  const session = await getSessionContext();
  if (session) {
    redirect(`/${locale}${dashboardPathForRole(session.profile.role)}`);
  }

  return <SignInForm />;
}
