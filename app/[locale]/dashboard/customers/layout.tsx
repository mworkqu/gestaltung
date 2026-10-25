import { setRequestLocale } from "next-intl/server";

import { requireSuperAdmin } from "@/lib/auth/guards";

// Customer data is super_admin only (every table read here agrees under RLS).
export const dynamic = "force-dynamic";

export default async function CustomersLayout({
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
