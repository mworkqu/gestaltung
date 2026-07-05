import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";

// The whole dashboard area is per-request and auth-gated here, once.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Single auth gate for every /dashboard/* route.
  const session = await getSessionContext();
  if (!session) {
    redirect(`/${locale}/sign-in`);
  }

  const t = await getTranslations("DashboardNav");
  const isClient = session.profile.role === "client";
  const isSuperAdmin = session.profile.role === "super_admin";
  const navItems = [
    { href: "/dashboard", label: t("overview") },
    // Inventory is hidden from clients in the UI (their table stays in the DB,
    // reserved for future use); workshops + super_admin keep it.
    ...(isClient
      ? []
      : [{ href: "/dashboard/inventory", label: t("inventory") }]),
    { href: "/design/jobs", label: t("jobs") },
    // Parts catalog + orders are super_admin only.
    ...(isSuperAdmin
      ? [
          { href: "/dashboard/parts/orders", label: t("partsOrders") },
          { href: "/dashboard/parts", label: t("partsCatalog") },
        ]
      : []),
  ];

  return (
    <div className="container py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-borderstrong/60 pb-4">
        <DashboardNav items={navItems} />
        <SignOutButton />
      </div>
      <div className="pt-8">{children}</div>
    </div>
  );
}
