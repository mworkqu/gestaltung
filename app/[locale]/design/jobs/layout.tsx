import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";

// Jobs moved out of /dashboard into the customer /design area (store-first
// Stage 3). This layout restores the single auth gate + page container the
// dashboard layout used to provide. Any role with a session may view jobs;
// RLS scopes which rows they actually see.
export const dynamic = "force-dynamic";

export default async function DesignJobsLayout({
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
