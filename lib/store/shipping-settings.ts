// Reads store_settings.shipping once per request (anon client; the setting is
// public) so every product card on a page can compute its "Arrives by" date
// without a database call of its own. React's cache() dedupes the read.

import { cache } from "react";

import { createPublicClient } from "@/lib/supabase/public";
import { parseShippingSettings, type ShippingSettings } from "@/lib/store/delivery";

export const loadShippingSettings = cache(async (): Promise<ShippingSettings | null> => {
  const supabase = createPublicClient();
  if (!supabase) return null;
  const { data } = await supabase.from("store_settings").select("value").eq("key", "shipping").maybeSingle();
  return parseShippingSettings(data?.value);
});
