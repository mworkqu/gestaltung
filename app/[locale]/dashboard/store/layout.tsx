import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// Parts management is super_admin only. The parent dashboard layout already
// gates on auth; here we additionally require the super_admin role and bounce
// everyone else back to the dashboard overview.
export const dynamic = "force-dynamic";

export default async function PartsDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") {
    redirect(`/${locale}/dashboard`);
  }

  return <>{children}</>;
}
