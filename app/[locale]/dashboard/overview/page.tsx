import { redirect } from "next/navigation";

import { overviewRedirectPath } from "@/lib/admin/nav";

// "Numbers & funnels" moved into the dashboard Home (D2, owner 2026-10-11): its
// cards and funnel are Home's top section (#numbers). Old links and bookmarks
// land there. The dashboard layout already gates auth.

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(overviewRedirectPath(locale));
}
