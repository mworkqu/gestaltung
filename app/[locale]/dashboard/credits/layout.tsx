import { setRequestLocale } from "next-intl/server";

import { requireSuperAdmin } from "@/lib/auth/guards";

// AI credits admin is super_admin only (every 0042 admin function re-checks).
export const dynamic = "force-dynamic";

export default async function CreditsLayout({
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
