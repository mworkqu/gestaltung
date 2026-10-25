import { setRequestLocale } from "next-intl/server";

import { requireSuperAdmin } from "@/lib/auth/guards";

// Payments are super_admin only (payments RLS + the RPCs agree).
export const dynamic = "force-dynamic";

export default async function PaymentsLayout({
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
