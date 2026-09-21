import { getTranslations, setRequestLocale } from "next-intl/server";

import { PrototypingWorkspace } from "@/components/prototyping/workspace";
import { providerStatus } from "@/lib/prototyping/providers";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Prototyping" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

// Wider than the project page: this is a workspace, not a document. The
// workspace loads its own data through the browser client so a guest behaves
// exactly like a signed-in client — RLS scopes both to their own auth.uid().
export const dynamic = "force-dynamic";

export default async function PrototypingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // Only the provider's public name crosses to the client — never its key.
  const { destination } = await providerStatus();

  return (
    <div className="container py-6">
      <PrototypingWorkspace projectId={id} briefDestination={destination} />
    </div>
  );
}
