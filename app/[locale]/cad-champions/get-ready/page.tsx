import { notFound } from "next/navigation";

import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Signed-in CC users only (Prompt 2 Step F): requireCcUser redirects to sign-in.
export const generateMetadata = placeholderMetadata("getReady", "/get-ready");

export default async function CcGetReadyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  await requireCcUser(locale, ccPath(locale, "/get-ready"));
  return <PlaceholderPage params={params} page="getReady" signedIn />;
}
