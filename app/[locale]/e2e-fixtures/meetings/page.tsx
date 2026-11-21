import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { MeetingsFixture } from "@/components/meetings/meetings-fixture";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";

// TEST-ONLY (lib/e2e-fixtures.ts): the meeting manage card in both states and
// the booking form, rendered with no Supabase and no session. 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MeetingsFixturePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MessagesScope scope="meetings">
      <main className="container max-w-2xl space-y-6 py-6">
        <MeetingsFixture />
      </main>
    </MessagesScope>
  );
}
