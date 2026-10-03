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

  it("reads store_category (0048) and lists the nine in the owner's order", () => {
    expect(
      listedCategories([
        { category: "3D printers", store_category: "3D printing", is_published: true },
        { category: "Prototyping", store_category: "Cables and connectors", is_published: true },
        { category: "Microcontrollers", store_category: "Boards and microcontrollers", is_published: true },
        { category: "Sensors", store_category: "Sensors", is_published: true },
        { category: "Other", store_category: "Tools and accessories", is_published: false },
      ])
    ).toEqual(["Boards and microcontrollers", "Sensors", "Cables and connectors", "3D printing"]);
  });

  it("falls back to the source category for rows read before 0048", () => {
    expect(
      listedCategories([
        { category: "Microcontrollers", is_published: true },
        { category: "Kits", store_category: null, is_published: true },
      ])
    ).toEqual(["Kits", "Microcontrollers"]);
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
