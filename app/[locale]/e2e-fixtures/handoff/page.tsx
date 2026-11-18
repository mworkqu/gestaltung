import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { HandoffFixture } from "@/components/handoff/handoff-fixture";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";

// TEST-ONLY (lib/e2e-fixtures.ts): every handoff state rendered statically,
// no Supabase, no session. 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function HandoffFixturePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MessagesScope scope="handoff">
      <main className="container max-w-2xl space-y-6 py-6">
        <HandoffFixture />
      </main>
    </MessagesScope>
  );
}
