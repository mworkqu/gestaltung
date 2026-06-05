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
  const navItems = [
    { href: "/dashboard", label: t("overview") },
    { href: "/dashboard/inventory", label: t("inventory") },
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
