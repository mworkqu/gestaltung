import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { StudioShell } from "@/components/studio/StudioShell";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { getSessionContext } from "@/lib/auth/get-session";
import { providerStatus } from "@/lib/prototyping/providers";
import { studioLibraryOverrides } from "@/lib/studio/library/remote";
import { pageMetadata } from "@/lib/seo";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

// Design Studio (P5-13 Phase 1): the client's flow from idea to "get it
// made". Private and per-visitor: the doc is loaded in the browser through
// the visitor's own session (guests included), exactly like the workspace.
// A super_admin also gets a small "Engineer view" link to the old workspace
// (checked here, never shown to anyone else).

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Studio" });
  return pageMetadata({ locale, path: "/projects", title: t("metaTitle"), noindex: true });
}

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ start?: string | string[]; step?: string | string[] }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const startChat = sp.start === "chat";
  const step = typeof sp.step === "string" ? sp.step : null;

  // Only the provider's public name crosses to the client — never its key.
  // Owner-edited / new library parts (studio_parts, 0070); [] before it runs.
  const [{ destination }, session, turnstileEnabled, t, libraryParts] = await Promise.all([
    providerStatus(),
    getSessionContext().catch(() => null),
    turnstileEnabledForPages(),
    getTranslations({ locale, namespace: "Studio" }),
    studioLibraryOverrides().catch(() => []),
  ]);
  const isAdmin = session?.profile.role === "super_admin";

  return (
    <MessagesScope scope="studio">
      <div className="container max-w-5xl space-y-3 py-5 sm:py-8">
        {isAdmin && (
          <div className="flex justify-end">
            <Link
              href={`/projects/${id}/prototyping`}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-mutedtext hover:text-cobalt"
            >
              {t("engineerView")}
            </Link>
          </div>
        )}
        <StudioShell projectId={id} destination={destination ?? ""} startChat={startChat} requestedStep={step} libraryParts={libraryParts} />
        <TurnstileChallenge enabled={turnstileEnabled} />
      </div>
    </MessagesScope>
  );
}
