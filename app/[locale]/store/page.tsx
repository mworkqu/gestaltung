import { setRequestLocale } from "next-intl/server";

import { parseStoreParams } from "@/lib/store/catalog";
import { metaFor } from "@/lib/meta";
import { StoreListing } from "./store-listing";

// The default /store listing (no query params): static per locale, refreshed
// at most every 5 minutes or at once when an admin edit calls
// revalidateStorefront() (tag "parts"). It never reads searchParams — that
// would make every request dynamic. A URL with ?q / ?category / ?material /
// ?stock / ?sort / ?page is rewritten (next.config.mjs) to ./search/page.tsx,
// which renders the same listing dynamically from cached data.
export const revalidate = 300;

export const generateMetadata = metaFor("store");

export default async function PartsStorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StoreListing locale={locale} state={parseStoreParams({})} />;
}
