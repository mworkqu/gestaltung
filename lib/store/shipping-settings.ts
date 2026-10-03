// Reads store_settings.shipping (anon client; the setting is public) so every
// product card on a page can compute its "Arrives by" date without a database
// call of its own. React's cache() dedupes the read within a render;
// unstable_cache keeps it across renders (tag "store-settings", 5 minutes) so
// ISR re-renders of the storefront do not hit the database for it.

import { cache } from "react";
import { unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import { parseShippingSettings, type ShippingSettings } from "@/lib/store/delivery";
import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";

const readShippingValue = unstable_cache(
  async (): Promise<unknown> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data } = await supabase.from("store_settings").select("value").eq("key", "shipping").maybeSingle();
    return data?.value ?? null;
  },
  ["store-settings:shipping"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

export const loadShippingSettings = cache(async (): Promise<ShippingSettings | null> => {
  return parseShippingSettings(await readShippingValue());
});
