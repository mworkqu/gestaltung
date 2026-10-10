import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

import { PrototypingWorkspace } from "@/components/prototyping/workspace";
import { providerStatus } from "@/lib/prototyping/providers";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";
import { getServicePrices } from "@/lib/store/public-catalog";
import { formatQar } from "@/lib/pricing/plans";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Prototyping" });
  return pageMetadata({ locale, path: "/projects", title: t("metaTitle"), description: t("metaDescription"), noindex: true });
}

// Wider than the project page: this is a workspace, not a document, so it
// isn't held to the 1280 px site container — the centre column gets the room
// (audit #24). The site header is hidden here (components/header-gate.tsx);
// the workspace's own bar carries the logo, the way back and the language
// switch. The workspace loads its own data through the browser client so a
// guest behaves exactly like a signed-in client — RLS scopes both to their own
// auth.uid().
export const dynamic = "force-dynamic";

export default async function PrototypingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ start?: string | string[] }>;
}) {
  const { locale, id } = await params;
  // ?start=chat: opened from "Describe your idea" (P1-11 / CC-1) — the brief
  // chat opens with the first turn, and the project gets a name from its brief.
  const startChat = (await searchParams).start === "chat";
  setRequestLocale(locale);
  // Only the provider's public name crosses to the client — never its key.
  const { destination } = await providerStatus();
  // P2-08: guests need a Turnstile token for /api/analyse while the switch is on.
  const turnstileEnabled = await turnstileEnabledForPages();
  // "Get it made" (client view) quotes the enclosure price from store_settings.service_prices.
  const enclosureFrom = await getServicePrices()
    .then((p) => formatQar(p.enclosure_from))
    .catch(() => null);

  return (
    <MessagesScope scope="all">
    <div className="mx-auto w-full max-w-[1760px] px-4 py-4 sm:px-6">
      <PrototypingWorkspace
        projectId={id}
        briefDestination={destination}
        startChat={startChat}
        turnstileEnabled={turnstileEnabled}
        enclosureFrom={enclosureFrom}
      />
      <TurnstileChallenge enabled={turnstileEnabled} />
    </div>
    </MessagesScope>
  );
}
