import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// /design/upload = the CAD upload → job creation entry (was /dashboard/jobs/new).
// Auth-gated like the rest of the job flow; provides the page container that
// used to come from the dashboard layout.
export const dynamic = "force-dynamic";

export default async function DesignUploadLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  return <div className="container py-10">{children}</div>;
}
