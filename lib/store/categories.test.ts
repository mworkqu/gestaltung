import { describe, expect, it } from "vitest";

import { isListed, listedCategories } from "@/lib/store/categories";

describe("listedCategories", () => {
  it("lists only categories with a published, unmerged product", () => {
    expect(
      listedCategories([
        { category: "Resistors", is_published: true, merged_into: null },
        { category: "Masonry", is_published: false, merged_into: null },
        { category: "Diodes", is_published: false, merged_into: "survivor-id" },
        { category: "Glazing", is_published: true, merged_into: "survivor-id" },
        { category: "Capacitors", is_published: true },
        { category: "Resistors", is_published: true, merged_into: null },
      ])
    ).toEqual(["Capacitors", "Resistors"]);
  });

  it("drops blank categories and keeps the value verbatim for the filter", () => {
    expect(
      listedCategories([
        { category: "", is_published: true },
        { category: "   ", is_published: true },
        { category: null, is_published: true },
        { category: "Motors", is_published: true },
      ])
    ).toEqual(["Motors"]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(listedCategories([])).toEqual([]);
  });
});

describe("isListed", () => {
  it("treats rows read before 0030 (no merged_into) as listed when published", () => {
    expect(isListed({ is_published: true })).toBe(true);
    expect(isListed({ is_published: false })).toBe(false);
    expect(isListed({ is_published: true, merged_into: "x" })).toBe(false);
  });
});
