import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { HandoffClaim } from "@/components/handoff/handoff-claim";
import { HandoffView } from "@/components/handoff/handoff-view";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { HANDOFF_TOKEN_RE } from "@/lib/plugin/client/handoff";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

// Private link from the chat plugin: never indexed, never in the sitemap.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function HandoffPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  // A malformed token never reaches Supabase: same message as an unknown one.
  const valid = HANDOFF_TOKEN_RE.test(token);

  return (
    <MessagesScope scope="handoff">
      <main className="container flex min-h-[60vh] items-center py-10">
        {valid ? (
          <>
            <HandoffClaim token={token} />
            <TurnstileChallenge enabled={await turnstileEnabledForPages()} />
          </>
        ) : (
          <HandoffView state="expired" />
        )}
      </main>
    </MessagesScope>
  );
}
