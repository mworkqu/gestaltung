import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// Studio library admin (P5-15c) is super_admin only; everyone else goes back
// to the dashboard (the parent layout already requires a session).
export const dynamic = "force-dynamic";

export default async function StudioLibraryLayout({
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
