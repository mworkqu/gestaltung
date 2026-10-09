// Per-page <title> and meta description (audit #56). Copy lives in the Meta
// namespace of messages/*.json as <key>Title / <key>Description. Canonical,
// hreflang, Open Graph and Twitter come from pageMetadata() in lib/seo.ts.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "@/lib/seo";

export type MetaKey =
  | "store"
  | "cart"
  | "checkout"
  | "success"
  | "about"
  | "contact"
  | "drawing"
  | "students"
  | "trust"
  | "institutions"
  | "institutionsProposal"
  | "pricing"
  | "caseStudies"
  | "partnersSchools"
  | "partnersAccelerators"
  | "signIn"
  | "signUp"
  | "inventory"
  | "dashboard";

// Where each page lives (no locale prefix) and whether it is private. Layouts
// that use metaFor() cover whole areas, so a private area is noindex.
const PAGES: Record<MetaKey, { path: string; noindex?: boolean }> = {
  store: { path: "/store" },
  cart: { path: "/store/cart", noindex: true },
  checkout: { path: "/store/checkout", noindex: true },
  success: { path: "/store/checkout/success", noindex: true },
  about: { path: "/about" },
  contact: { path: "/contact" },
  drawing: { path: "/design/drawing" },
  students: { path: "/students" },
  trust: { path: "/trust" },
  institutions: { path: "/institutions" },
  // P2-05: the print sheet is not for search results.
  institutionsProposal: { path: "/institutions/proposal", noindex: true },
  pricing: { path: "/pricing" },
  caseStudies: { path: "/case-studies" },
  partnersSchools: { path: "/partners/schools" },
  partnersAccelerators: { path: "/partners/accelerators" },
  signIn: { path: "/sign-in", noindex: true },
  signUp: { path: "/sign-up", noindex: true },
  inventory: { path: "/inventory", noindex: true },
  dashboard: { path: "/dashboard", noindex: true },
};

export async function pageMeta(
  locale: string,
  key: MetaKey,
  /** Overrides the page's default robots rule (e.g. /case-studies is noindex while empty). */
  opts: { noindex?: boolean } = {}
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Meta" });
  const { path } = PAGES[key];
  const noindex = opts.noindex ?? PAGES[key].noindex;
  return pageMetadata({
    locale,
    path,
    title: t(`${key}Title`),
    description: t(`${key}Description`),
    noindex,
  });
}

/** generateMetadata for a page or layout that only needs its locale. */
export const metaFor =
  (key: MetaKey) =>
  async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> =>
    pageMeta((await params).locale, key);
