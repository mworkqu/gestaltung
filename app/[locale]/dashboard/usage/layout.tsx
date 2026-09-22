import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// AI usage is super_admin only (ai_usage RLS agrees: only super_admin reads).
export const dynamic = "force-dynamic";

export default async function UsageLayout({
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
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);
  return <>{children}</>;
}
