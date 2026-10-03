import { setRequestLocale } from "next-intl/server";

import { parseStoreParams, type RawSearchParams } from "@/lib/store/catalog";
import { metaFor } from "@/lib/meta";
import { StoreListing } from "../store-listing";

// /store with search, filters, a sort or a page number. Visitors never see this
// path: next.config.mjs rewrites /<locale>/store?<any STORE_URL_PARAMS> here, so
// the browser keeps /store?... and links stay as they were. Reading
// searchParams makes this route dynamic (rendered per request); the catalogue
// data behind it is still cached per normalised query (lib/store/public-catalog.ts).
// Metadata is the /store page's (canonical /store).
export const generateMetadata = metaFor("store");

export default async function StoreSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const state = parseStoreParams(await searchParams);
  return <StoreListing locale={locale} state={state} />;
}
