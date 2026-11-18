import { describe, expect, it } from "vitest";

import { catalogTagsFor, CRON_SKU_TAG_CAP } from "@/lib/cache/catalog-tags";
import { CONTACT_PHONE_TAG, SETTINGS_TAG } from "@/lib/cache/storefront";

import { checkRevalidateTags, FIXED_TAGS, MAX_REVALIDATE_TAGS } from "./revalidate-tags";

describe("revalidate tag allow-list", () => {
  it("matches the storefront's own tag names", () => {
    expect(FIXED_TAGS).toContain(SETTINGS_TAG);
    expect(FIXED_TAGS).toContain(CONTACT_PHONE_TAG);
  });

  it("accepts every shape catalogTagsFor produces, up to the cap", () => {
    const skus = Array.from({ length: CRON_SKU_TAG_CAP }, (_, i) => `VLT-${40000000000000 + i}`);
    const tags = catalogTagsFor({ skus, listingChanged: true });
    expect(tags.length).toBe(CRON_SKU_TAG_CAP + 1);
    expect(checkRevalidateTags(tags)).toEqual({ ok: true, tags });
    expect(checkRevalidateTags(catalogTagsFor({ skus: [...skus, "X-1"], listingChanged: false }))).toEqual({ ok: true, tags: ["parts"] });
    expect(checkRevalidateTags(["parts", "store-settings"])).toEqual({ ok: true, tags: ["parts", "store-settings"] });
    expect(checkRevalidateTags(["part-DK-296-1395-1-ND", "part-GR-001", "part-GR-001"])).toEqual({ ok: true, tags: ["part-DK-296-1395-1-ND", "part-GR-001"] });
  });

  it("refuses anything else", () => {
    expect(checkRevalidateTags([])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags("parts")).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags(["layout"])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags(["_N_T_/en"])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags(["part-"])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags(["part-a b"])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags([`part-${"x".repeat(121)}`])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags(["parts", 3])).toEqual({ ok: false, error: "bad_tags" });
    expect(checkRevalidateTags(Array.from({ length: MAX_REVALIDATE_TAGS + 1 }, (_, i) => `part-${i}`))).toEqual({ ok: false, error: "too_many_tags" });
  });
});
