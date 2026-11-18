// Which cache tags POST /api/internal/revalidate accepts (the worker cannot
// call Next's revalidateTag itself). Only the storefront tag shapes from
// lib/cache/catalog-tags.ts + lib/cache/storefront.ts, so a leaked secret can
// at most re-render pages, never purge an arbitrary tag. Pure.

import { CATALOG_TAG, CRON_SKU_TAG_CAP, LISTING_TAG } from "@/lib/cache/catalog-tags";

/** Mirrors SETTINGS_TAG / CONTACT_PHONE_TAG in lib/cache/storefront.ts (that file imports next/cache). */
export const FIXED_TAGS = [CATALOG_TAG, LISTING_TAG, "store-settings", "contact-phone"] as const;
/** "part-<sku>": printable ASCII, no spaces (SKUs are VLT-…, DK-…, MS-…, GR-… and owner-typed codes). */
export const PART_TAG_RE = /^part-[\x21-\x7E]{1,120}$/;
/** One listing tag + the per-SKU cap, plus the settings tags; a full purge is one tag. */
export const MAX_REVALIDATE_TAGS = CRON_SKU_TAG_CAP + FIXED_TAGS.length;

export type TagCheck = { ok: true; tags: string[] } | { ok: false; error: "bad_tags" | "too_many_tags" };

export function isAllowedTag(tag: unknown): tag is string {
  return typeof tag === "string" && ((FIXED_TAGS as readonly string[]).includes(tag) || PART_TAG_RE.test(tag));
}

export function checkRevalidateTags(input: unknown): TagCheck {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "bad_tags" };
  if (input.length > MAX_REVALIDATE_TAGS) return { ok: false, error: "too_many_tags" };
  if (!input.every(isAllowedTag)) return { ok: false, error: "bad_tags" };
  return { ok: true, tags: [...new Set(input as string[])] };
}
