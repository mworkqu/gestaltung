import { setRequestLocale } from "next-intl/server";

import { requireSuperAdmin } from "@/lib/auth/guards";

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
  await requireSuperAdmin(locale);
  return <>{children}</>;
}
