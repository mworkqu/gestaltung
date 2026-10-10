// Server-side read of store_settings.studio_cad (which CAD backend builds Studio
// models). Same cookie-free anon client + unstable_cache + "store-settings" tag
// as lib/cad/engine-server.ts. No row, a bad value or any error = "browser".
// The row is optional (no migration); SQL to add it: docs/STUDIO_CAD.md.

import { unstable_cache } from "next/cache";

import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { createPublicClient } from "@/lib/supabase/public";
import { STUDIO_CAD_KEY, parseStudioCadSetting, type CadBackendId } from "./cad-adapter";

export const getStudioCadSetting = unstable_cache(
  async (): Promise<CadBackendId> => {
    try {
      const supabase = createPublicClient();
      if (!supabase) return "browser";
      const { data, error } = await supabase.from("store_settings").select("value").eq("key", STUDIO_CAD_KEY).maybeSingle();
      if (error || !data) return "browser";
      return parseStudioCadSetting(data.value);
    } catch {
      return "browser";
    }
  },
  ["studio-cad"],
  { tags: [SETTINGS_TAG], revalidate: STOREFRONT_REVALIDATE }
);
