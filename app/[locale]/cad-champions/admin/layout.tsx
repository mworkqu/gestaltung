import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminNav } from "@/components/cad-champions/admin/admin-nav";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Admin shell (Prompt 11): staff only (instructor or admin). The side nav
// shows instructors only Today, Review, Questions and Students; every
// admin-only page ALSO calls requireCcAdmin itself, and every server action
// re-checks the role (lib/cad-champions/admin/server.ts adminGuard).

export const dynamic = "force-dynamic";

export default async function CcAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcStaff(locale, ccPath(locale, "/admin"));
  const t = await getTranslations({ locale, namespace: "CC.admin.nav" });
  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:py-8">
      <aside className="min-w-0">
        <AdminNav isAdmin={cc.isAdmin} />
      </aside>
      <div className="min-w-0 [&>.container]:max-w-none [&>.container]:px-0">{children}</div>
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
