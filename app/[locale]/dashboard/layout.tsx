import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { DashboardNav, type NavGroup } from "@/components/dashboard/dashboard-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { metaFor } from "@/lib/meta";

// The whole dashboard area is per-request and auth-gated here, once.
export const dynamic = "force-dynamic";

export const generateMetadata = metaFor("dashboard");

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
  const groups: NavGroup[] = isSuperAdmin
    ? [
        { items: [{ href: "/dashboard", label: t("overview") }] },
        {
          label: t("group_customers"),
          items: [
            { href: "/dashboard/leads", label: t("leads") },
            { href: "/dashboard/store/orders", label: t("partsOrders") },
            { href: "/dashboard/projects", label: t("projects") },
          ],
        },
        {
          label: t("group_store"),
          items: [
            { href: "/dashboard/store/overview", label: t("overviewStore") },
            { href: "/dashboard/store", label: t("partsCatalog") },
            { href: "/dashboard/store/quick", label: t("quickAdd") },
            { href: "/dashboard/store/attributes", label: t("storeAttributes") },
            { href: "/dashboard/store/restock", label: t("restock") },
            { href: "/dashboard/store/gaps", label: t("sourcingGaps") },
          ],
        },
        {
          label: t("group_suppliers"),
          items: [
            { href: "/dashboard/store/suppliers", label: t("suppliers") },
            { href: "/dashboard/store/suppliers/lookup", label: t("findParts") },
            { href: "/dashboard/store/suppliers/voltaat", label: t("voltaatSync") },
          ],
        },
        {
          label: t("group_settings"),
          items: [
            { href: "/dashboard/usage", label: t("aiUsage") },
            { href: "/inventory", label: t("inventory") },
          ],
        },
      ]
    : [
        {
          items: [
            { href: "/dashboard", label: t("overview") },
            { href: "/projects", label: t("myProjects") },
            // Inventory is hidden from clients; workshops keep it.
            ...(isClient ? [] : [{ href: "/inventory", label: t("inventory") }]),
          ],
        },
      ];

  return (
    <div className="container py-8">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <DashboardNav groups={groups} />
          <SignOutButton />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
