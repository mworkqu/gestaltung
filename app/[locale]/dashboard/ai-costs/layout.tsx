import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// AI costs are super_admin only (the cost RPC and ai_usage RLS agree).
export const dynamic = "force-dynamic";

export default async function AiCostsLayout({
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
