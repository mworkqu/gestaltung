// cc_content_overrides reads — SERVER ONLY. Cookie-free anon client (the
// table is public copy, RLS lets anyone read it), cached for 5 minutes and
// tagged CC_OVERRIDES_TAG so admin saves show at once (revalidateTag).
// Before migration 0085 runs (or on any error) every helper returns the
// fallback: the message-file text.
//
//   loadContentOverrides(locale)           -> Map key -> value (one locale)
//   getContentOverride(key, locale, fb)    -> override or fallback
//   revalidateContentOverrides()           -> call after every admin write

import { revalidateTag, unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";

import { toOverrideMap, type OverrideLocale, type OverrideRow } from "./overrides";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/content/overrides-server.ts is server-only");

export const CC_OVERRIDES_TAG = "cc-content-overrides";

const readAll = unstable_cache(
  async (): Promise<OverrideRow[]> => {
    const db = createPublicClient();
    if (!db) return [];
    try {
      const { data, error } = await db.from("cc_content_overrides").select("key,locale,value").limit(5000);
      if (error) {
        if (!["42P01", "PGRST205", "PGRST204"].includes(error.code ?? "")) console.error("[cc-overrides] read failed:", error.code ?? error.message);
        return [];
      }
      return (data ?? []) as OverrideRow[];
    } catch (e) {
      console.error("[cc-overrides] read failed:", e instanceof Error ? e.message : "unknown");
      return [];
    }
  },
  ["cc-content-overrides-v1"],
  { revalidate: 300, tags: [CC_OVERRIDES_TAG] },
);

export async function loadContentOverrides(locale: OverrideLocale): Promise<Map<string, string>> {
  try {
    return toOverrideMap(await readAll(), locale);
  } catch {
    return new Map();
  }
}

/** Both locales (admin editors). */
export async function loadAllContentOverrides(): Promise<OverrideRow[]> {
  try {
    return await readAll();
  } catch {
    return [];
  }
}

export async function getContentOverride(key: string, locale: OverrideLocale, fallback: string): Promise<string> {
  const map = await loadContentOverrides(locale);
  const v = map.get(key);
  return v != null && v.trim() !== "" ? v : fallback;
}

export function revalidateContentOverrides(): void {
  try {
    revalidateTag(CC_OVERRIDES_TAG);
  } catch {
    // outside a request (tests): nothing to revalidate
  }
}
