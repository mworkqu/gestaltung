import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { StudioFixture } from "@/components/studio/StudioFixture";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";

// TEST-ONLY (lib/e2e-fixtures.ts): the Design Studio with a mock StudioApi
// (canned answers through our real rules), no Supabase, no session, no write.
// 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function StudioFixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ store?: string; step?: string }>;
}) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  return (
    <MessagesScope scope="studio">
      <div className="container max-w-5xl py-5 sm:py-8">
        <StudioFixture stored={sp.store === "1"} step={typeof sp.step === "string" ? sp.step : null} />
      </div>
    </MessagesScope>
  );
}
