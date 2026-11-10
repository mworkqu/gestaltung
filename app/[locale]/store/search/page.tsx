import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { parseStoreParams, storeParamsOutOfRange, type RawSearchParams } from "@/lib/store/catalog";
import { metaFor } from "@/lib/meta";
import { StoreListing } from "../store-listing";

// /store with search, filters, a sort or a page number. Visitors never see this
// path: next.config.mjs rewrites /<locale>/store?<any STORE_URL_PARAMS> here, so
// the browser keeps /store?... and links stay as they were. Reading
// searchParams makes this route dynamic (rendered per request); the catalogue
// data behind it is still cached per normalised query (lib/store/public-catalog.ts).
// Metadata is the /store page's (canonical /store).
//
// Caps (consolidation 2.3): a query longer than MAX_STORE_QUERY (64) or a page
// past MAX_STORE_PAGE (20) is answered with the 404 page. A page route cannot
// send a 400; notFound() is the closest status Next allows here, and it
// renders nothing from the catalogue (robots.txt also keeps crawlers off
// /store?*).
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
  const raw = await searchParams;
  if (storeParamsOutOfRange(raw)) notFound();
  const state = parseStoreParams(raw);
  return <StoreListing locale={locale} state={state} />;
}
