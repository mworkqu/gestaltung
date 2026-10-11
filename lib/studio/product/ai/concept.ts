// Optional AI concept picture for the share card (P5-16 spec §8) — OFF by default.
//
// store_settings.studio_concept_image = true | {"enabled": true} turns it on; no
// row, false or anything else = off. Even when on, NOTHING is generated yet: the
// image-output Gemini models (…-flash-image) are not on the free API tier the
// site uses, and the owner rule is "no paid API". generateConceptImage() is a
// documented stub that always answers { skipped: "no_free_image_model" }; wire a
// real call here only if Google offers a free image-output model on this key.
// The preview pictures themselves are never AI-drawn: they are renders of the
// real model (worker), so this only ever decorates the share card.

import type { SupabaseClient } from "@supabase/supabase-js";

export function parseConceptSetting(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true) return true;
  return false;
}

/** store_settings.studio_concept_image (default false; a missing row or a read error = false). */
export async function conceptImageEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("store_settings").select("value").eq("key", "studio_concept_image").maybeSingle();
    if (error || !data) return false;
    return parseConceptSetting((data as { value: unknown }).value);
  } catch {
    return false;
  }
}

export type ConceptResult = { skipped: "off" | "no_free_image_model" } | { png: Uint8Array };

/** Stub: see the header. Never calls a paid model. */
export async function generateConceptImage(opts: { enabled: boolean }): Promise<ConceptResult> {
  if (!opts.enabled) return { skipped: "off" };
  return { skipped: "no_free_image_model" };
}
