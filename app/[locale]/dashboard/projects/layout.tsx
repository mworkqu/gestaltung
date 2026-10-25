import { setRequestLocale } from "next-intl/server";

import { requireSuperAdmin } from "@/lib/auth/guards";

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
  await requireSuperAdmin(locale);
  return <>{children}</>;
}
