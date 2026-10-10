import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { guestRedirect } from "@/lib/auth/guest-redirect";
import { DashboardNav, type NavGroup } from "@/components/dashboard/dashboard-nav";
import { adminNavGroups } from "@/components/dashboard/admin-nav-groups";
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

  // Single auth gate for every /dashboard/* route. A guest (anonymous session)
  // has no dashboard: send them to their projects (D5).
  const user = await getAuthUser();
  const guestTarget = guestRedirect({ user, path: `/${locale}/dashboard` });
  if (guestTarget) redirect(guestTarget);

  const session = await getSessionContext(user);
  if (!session) {
    redirect(`/${locale}/sign-in`);
  }

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

  return (
    <MessagesScope scope="all">
    <div className="container py-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <DashboardNav groups={groups} />
          <SignOutButton />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
    </MessagesScope>
  );
}
