import { setRequestLocale } from "next-intl/server";

import { requireSuperAdmin } from "@/lib/auth/guards";

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
  await requireSuperAdmin(locale);
  return <>{children}</>;
}
