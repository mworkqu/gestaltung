// Server-side read of the v2 site flag (P3-03). store_settings.site_v2 =
// {"enabled": true|false}; no row, a malformed value or any error = off.
// Same cookie-free anon client + unstable_cache + "store-settings" tag as the
// other settings reads (lib/store/public-catalog.ts), so the v2 pages that
// call it for their robots rule stay static / ISR.

import type { Metadata } from "next";
import { unstable_cache } from "next/cache";

import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { pageMetadata, type PageMetadataInput } from "@/lib/seo";
import { createPublicClient } from "@/lib/supabase/public";

export const SITE_V2_KEY = "site_v2";

/** A jsonb value as PostgREST returns it (object), or a JSON string typed in by hand. */
export function isSiteV2On(raw: unknown): boolean {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true;
}

export const getSiteV2Enabled = unstable_cache(
  async (): Promise<boolean> => {
    try {
      const supabase = createPublicClient();
      if (!supabase) return false;
      const { data, error } = await supabase.from("store_settings").select("value").eq("key", SITE_V2_KEY).maybeSingle();
      if (error || !data) return false;
      return isSiteV2On(data.value);
    } catch {
      return false;
    }
  },
  ["site-v2"],
  { tags: [SETTINGS_TAG], revalidate: STOREFRONT_REVALIDATE },
);

/**
 * Metadata for a page under app/[locale]/v2: canonical + hreflang point at the
 * PUBLIC path (never /v2), and the page is noindex until the flag is on.
 */
export async function v2PageMetadata(input: PageMetadataInput): Promise<Metadata> {
  const meta = pageMetadata({ ...input, noindex: false });
  if (await getSiteV2Enabled()) return meta;
  return { ...meta, robots: { index: false, follow: false } };
}
