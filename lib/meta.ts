// Per-page <title> and meta description (audit #56). Copy lives in the Meta
// namespace of messages/*.json as <key>Title / <key>Description.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export type MetaKey =
  | "store"
  | "cart"
  | "checkout"
  | "success"
  | "about"
  | "contact"
  | "drawing"
  | "signIn"
  | "signUp"
  | "inventory"
  | "dashboard";

export async function pageMeta(locale: string, key: MetaKey): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Meta" });
  return { title: t(`${key}Title`), description: t(`${key}Description`) };
}

/** generateMetadata for a page or layout that only needs its locale. */
export const metaFor =
  (key: MetaKey) =>
  async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> =>
    pageMeta((await params).locale, key);
