import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { dashboardPathForRole } from "@/lib/auth/redirects";
import { SignUpForm } from "@/components/auth/sign-up-form";

// Reads the session cookie to redirect already-signed-in users; keep per-request.
export const dynamic = "force-dynamic";

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (session) {
    redirect(`/${locale}${dashboardPathForRole(session.profile.role)}`);
  }

  return <SignUpForm />;
}
