import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminOverview } from "@/components/dashboard/admin-overview";
import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";

// The old dashboard home (counts, funnel, price cohorts, latest messages and
// orders), moved here when the home became four tiles (P5-12). Reached from
// the "More" menu. super_admin only.

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);

  const t = await getTranslations("AdminHome");
  return (
    <div className="space-y-4">
      <Link href="/dashboard" className="inline-block text-sm font-semibold text-cobalt hover:underline">
        {t("backHome")}
      </Link>
      <AdminOverview locale={locale} />
    </div>
  );
}
