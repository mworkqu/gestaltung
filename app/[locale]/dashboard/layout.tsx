import { getTranslations, setRequestLocale } from "next-intl/server";

import { requireSignedIn } from "@/lib/auth/guards";
import { DashboardNav, type NavGroup } from "@/components/dashboard/dashboard-nav";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { adminNavGroups, adminTabSets } from "@/components/dashboard/admin-nav-groups";
import { BackToTop } from "@/components/back-to-top";
import { loadNavBadges } from "@/lib/admin/nav-badges";
import type { NavBadges } from "@/lib/admin/nav";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { metaFor } from "@/lib/meta";
import { MessagesScope } from "@/components/i18n/messages-scope";

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

  // Auth gate for every /dashboard/* route. A guest (anonymous session) has no
  // dashboard: send them to their projects (D5). Admin pages check the role
  // again themselves (requireSuperAdmin); the reads are cached per request.
  const session = await requireSignedIn(locale);

  const t = await getTranslations("DashboardNav");
  const isClient = session.profile.role === "client";
  const isSuperAdmin = session.profile.role === "super_admin";
  const groups: NavGroup[] = isSuperAdmin
    ? adminNavGroups(t)
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
  // Sidebar badges (D2): not awaited, streamed into the nav so the page never waits.
  const badges = isSuperAdmin ? loadNavBadges(await createClient()).catch((): NavBadges => ({})) : undefined;

  return (
    <MessagesScope scope="all">
    <div className="container py-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <DashboardNav groups={groups} badges={badges} />
          <SignOutButton />
        </aside>
        <div className="min-w-0">
          {isSuperAdmin && <DashboardTabs sets={adminTabSets(t)} />}
          {children}
        </div>
      </div>
      <BackToTop afterScreens={2} />
    </div>
    </MessagesScope>
  );
}
