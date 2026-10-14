import { describe, expect, it } from "vitest";

import { groupNoResultSearches, helpfulStats, helpfulTotals, normaliseQuery, parseSlugList, validateHelpArticle, validateHelpVideoId } from "./help";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("groupNoResultSearches", () => {
  it("groups by lower(trim) with counts, locales and last searched", () => {
    const rows = [
      { query: " STEP Export ", locale: "en", results_count: 0, created_at: day(3) },
      { query: "step   export", locale: "ar", results_count: 0, created_at: day(1) },
      { query: "step export", locale: "en", results_count: 0, created_at: day(10) },
      { query: "refund", locale: "en", results_count: 0, created_at: day(2) },
    ];
    const out = groupNoResultSearches(rows, NOW);
    expect(out[0]).toEqual({ query: "step export", count: 3, lastSearched: day(1), en: 2, ar: 1 });
    expect(out[1].query).toBe("refund");
  });
  it("ignores results > 0, blank queries and rows older than 30 days", () => {
    const out = groupNoResultSearches(
      [
        { query: "found", locale: "en", results_count: 2, created_at: day(1) },
        { query: "   ", locale: "en", results_count: 0, created_at: day(1) },
        { query: "old", locale: "en", results_count: 0, created_at: day(31) },
        { query: "bad date", locale: "en", results_count: 0, created_at: "nope" },
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });
  it("orders ties by newest, then alphabetically, and caps", () => {
    const rows = [
      { query: "b", locale: "en", results_count: 0, created_at: day(5) },
      { query: "a", locale: "en", results_count: 0, created_at: day(5) },
      { query: "c", locale: "en", results_count: 0, created_at: day(1) },
    ];
    expect(groupNoResultSearches(rows, NOW).map((x) => x.query)).toEqual(["c", "a", "b"]);
    expect(groupNoResultSearches(rows, NOW, 30, 2)).toHaveLength(2);
  });
  it("normaliseQuery", () => {
    expect(normaliseQuery("  A  B ")).toBe("a b");
  });
});

describe("helpful stats", () => {
  it("percent", () => {
    expect(helpfulStats(3, 1)).toEqual({ yes: 3, no: 1, total: 4, percent: 75 });
    expect(helpfulStats(0, 0).percent).toBeNull();
    expect(helpfulStats(-4, null)).toEqual({ yes: 0, no: 0, total: 0, percent: null });
  });
  it("totals", () => {
    expect(helpfulTotals([{ helpful_yes: 2, helpful_no: 1 }, { helpful_yes: 1, helpful_no: 0 }]).percent).toBe(75);
  });
});

describe("article validation", () => {
  const ok = { slug: "my-article", category: "account", title_en: "T", title_ar: "ع", body_en: "x", body_ar: "ب" };
  it("accepts", () => {
    expect(validateHelpArticle(ok).ok).toBe(true);
  });
  it("rejects bad slug, category, video", () => {
    const r = validateHelpArticle({ ...ok, slug: "Bad", category: "nope", video_id: "zzz" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["category", "slug", "video_id"]);
  });
  it("publishing needs both bodies", () => {
    const r = validateHelpArticle({ ...ok, body_ar: "", is_published: true });
    expect(r.ok).toBe(false);
    expect(validateHelpArticle({ ...ok, body_ar: "", is_published: false }).ok).toBe(true);
  });
  it("cleans related lists", () => {
    const r = validateHelpArticle({ ...ok, related_slugs: "my-article, other-one  bad Slug other-one", related_glossary_terms: ["volume", "zzz"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.related_slugs).toEqual(["other-one", "bad"]);
      expect(r.value.related_glossary_terms).toEqual(["volume"]);
    }
  });
  it("slug list and video", () => {
    expect(parseSlugList("a, b\nc", "b")).toEqual(["a", "c"]);
    expect(validateHelpVideoId("youtube:dQw4w9WgXcQ")).toEqual({ ok: true, value: "youtube:dQw4w9WgXcQ" });
    expect(validateHelpVideoId("")).toEqual({ ok: true, value: null });
  });
});
