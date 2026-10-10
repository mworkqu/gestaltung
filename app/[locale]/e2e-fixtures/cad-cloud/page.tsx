import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { CadCloudFixture } from "@/components/credits/cad-cloud-fixture";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";

// TEST-ONLY (lib/e2e-fixtures.ts): the cloud CAD result card rendered from a
// stored-looking result, no Supabase, no session. 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CadCloudFixturePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MessagesScope scope="all">
      <main className="container max-w-2xl py-6">
        <CadCloudFixture />
      </main>
    </MessagesScope>
  );
}
