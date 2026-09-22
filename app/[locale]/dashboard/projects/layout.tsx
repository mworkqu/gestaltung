import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// The project browser is super_admin only. Workshops and clients are sent
// back to the dashboard; the export API checks the role again on its own.
export const dynamic = "force-dynamic";

export default async function AdminProjectsLayout({
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
