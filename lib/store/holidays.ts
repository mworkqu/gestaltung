// store_settings.holidays on its own, so that shipping-settings.ts can read the
// working-day calendar without importing public-catalog.ts, which reads shipping
// settings back (madge flagged the cycle). public-catalog.ts re-exports
// getHolidays, so existing callers are unaffected.

import { unstable_cache } from "next/cache";

import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { createPublicClient } from "@/lib/supabase/public";
import { HOLIDAYS_KEY, parseHolidays, type Holidays } from "@/lib/store/working-days";

/**
 * store_settings.holidays (P2-06, 0054): the weekend + public holidays that
 * every promise date skips. null when the row does not exist (0054 not run):
 * callers then keep calendar days, exactly like the database before 0054.
 */
export const getHolidays = unstable_cache(
  async (): Promise<Holidays | null> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data, error } = await supabase.from("store_settings").select("value").eq("key", HOLIDAYS_KEY).maybeSingle();
    if (error || !data) return null;
    return parseHolidays(data.value);
  },
  ["store-settings:holidays"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);
