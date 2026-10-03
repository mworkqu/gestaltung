import { describe, expect, it } from "vitest";

import {
  emptyState,
  hasActiveFilters,
  leadClassesFor,
  parseStoreParams,
  resolveSort,
  searchFilter,
  searchTerms,
  sortOptions,
  storeQuery,
} from "@/lib/store/catalog";

describe("parseStoreParams", () => {
  it("defaults: no query → name A–Z, page 1", () => {
    expect(parseStoreParams({})).toEqual({ q: "", category: undefined, material: undefined, stock: undefined, sort: "name", page: 1 });
  });

  it("a query defaults to relevance", () => {
    expect(parseStoreParams({ q: "  esp32  " })).toMatchObject({ q: "esp32", sort: "relevance" });
  });

  it("ignores unknown or removed delivery options (old links keep working)", () => {
    expect(parseStoreParams({ stock: "in_stock" }).stock).toBeUndefined();
    expect(parseStoreParams({ stock: "on_request" }).stock).toBeUndefined();
    expect(parseStoreParams({ stock: "nonsense" }).stock).toBeUndefined();
    expect(parseStoreParams({ stock: "1_2_weeks" }).stock).toBe("1_2_weeks");
  });

  it("cleans the page and sort", () => {
    expect(parseStoreParams({ page: "-3" }).page).toBe(1);
    expect(parseStoreParams({ page: "abc" }).page).toBe(1);
    expect(parseStoreParams({ page: "4" }).page).toBe(4);
    expect(parseStoreParams({ sort: "price_desc" }).sort).toBe("price_desc");
    expect(parseStoreParams({ sort: "relevance" }).sort).toBe("name");
    expect(parseStoreParams({ sort: "hacker" }).sort).toBe("name");
  });

  it("takes the first value of a repeated param", () => {
    expect(parseStoreParams({ category: ["Sensors", "Motors"] }).category).toBe("Sensors");
  });
});

describe("resolveSort / sortOptions", () => {
  it("relevance needs a query", () => {
    expect(resolveSort("relevance", false)).toBe("name");
    expect(resolveSort("relevance", true)).toBe("relevance");
    expect(resolveSort(undefined, true)).toBe("relevance");
    expect(sortOptions(false)).toEqual(["price_asc", "price_desc", "name"]);
    expect(sortOptions(true)).toEqual(["relevance", "price_asc", "price_desc", "name"]);
  });
});

describe("storeQuery", () => {
  const base = parseStoreParams({ q: "esp32", category: "Modules", stock: "3_5_days", page: "3" });

  it("changing the search, sort or a filter resets to page 1", () => {
    expect(storeQuery(base, { q: "relay" })).toEqual({ q: "relay", category: "Modules", stock: "3_5_days" });
    expect(storeQuery(base, { sort: "price_asc" })).toEqual({ q: "esp32", category: "Modules", stock: "3_5_days", sort: "price_asc" });
    expect(storeQuery(base, { category: "" })).toEqual({ q: "esp32", stock: "3_5_days" });
  });

  it("paging keeps everything else", () => {
    expect(storeQuery(base, { page: 4 })).toEqual({ q: "esp32", category: "Modules", stock: "3_5_days", page: "4" });
    expect(storeQuery(base, { page: 1 })).toEqual({ q: "esp32", category: "Modules", stock: "3_5_days" });
  });

  it("leaves the default sort out of the URL", () => {
    expect(storeQuery(base, { sort: "relevance" })).not.toHaveProperty("sort");
    expect(storeQuery(parseStoreParams({}), { sort: "name" })).toEqual({});
  });

  it("an implicit sort follows the query; a chosen one is kept", () => {
    expect(storeQuery(parseStoreParams({}), { q: "relay" })).toEqual({ q: "relay" });
    expect(storeQuery(parseStoreParams({ sort: "price_desc" }), { q: "relay" })).toEqual({ q: "relay", sort: "price_desc" });
    // Clearing the search drops relevance.
    expect(storeQuery(base, { q: "" })).toEqual({ category: "Modules", stock: "3_5_days" });
  });
});

describe("hasActiveFilters (Clear filters, both locales)", () => {
  it("is false only for the plain store", () => {
    expect(hasActiveFilters(parseStoreParams({}))).toBe(false);
    expect(hasActiveFilters(parseStoreParams({ q: "x" }))).toBe(true);
    expect(hasActiveFilters(parseStoreParams({ category: "Sensors" }))).toBe(true);
    expect(hasActiveFilters(parseStoreParams({ material: "Steel" }))).toBe(true);
    expect(hasActiveFilters(parseStoreParams({ stock: "2_4_weeks" }))).toBe(true);
    expect(hasActiveFilters(parseStoreParams({ sort: "price_asc" }))).toBe(true);
    expect(hasActiveFilters(parseStoreParams({ stock: "in_stock" }))).toBe(false);
  });
});

describe("leadClassesFor (delivery-time options → lead_time_class)", () => {
  it("maps by each class's upper bound in days", () => {
    expect(leadClassesFor("3_5_days")).toEqual(["in_stock", "3_5_days"]);
    expect(leadClassesFor("1_2_weeks")).toEqual(["1_2_weeks"]);
    expect(leadClassesFor("2_4_weeks")).toEqual(["2_4_weeks"]);
  });
});

describe("emptyState", () => {
  it("nothing to decide when products are shown", () => {
    expect(emptyState(parseStoreParams({ q: "x" }), 3, 3)).toBeNull();
  });

  it("a search with no results", () => {
    expect(emptyState(parseStoreParams({ q: "flux capacitor" }), 0, 0)).toEqual({ kind: "search", clearFilters: false });
    expect(emptyState(parseStoreParams({ q: "flux", category: "Sensors" }), 0, 0)).toEqual({ kind: "search", clearFilters: true });
  });

  it("filters with no results and no search", () => {
    expect(emptyState(parseStoreParams({ category: "Sensors", stock: "3_5_days" }), 0, 0)).toEqual({ kind: "filters" });
  });

  it("a page number past the end", () => {
    expect(emptyState(parseStoreParams({ page: "9" }), 20, 0)).toEqual({ kind: "page" });
  });

  it("an empty catalogue", () => {
    expect(emptyState(parseStoreParams({ sort: "price_asc" }), 0, 0)).toEqual({ kind: "catalog" });
  });
});

describe("searchFilter", () => {
  it("strips characters that break PostgREST syntax", () => {
    expect(searchTerms("esp32, (cam)* 100%")).toEqual(["esp32", "cam", "100"]);
    expect(searchTerms(" ,() ")).toEqual([]);
    expect(searchFilter(" ,() ")).toBeNull();
  });

  it("one word → one or-group over the searchable columns", () => {
    const f = searchFilter("ESP32")!;
    expect(f).toContain("name.ilike.%esp32%");
    expect(f).toContain("name_ar.ilike.%esp32%");
    expect(f).toContain("sku.ilike.%esp32%");
    expect(f).toContain("category.ilike.%esp32%");
    expect(f.startsWith("and(")).toBe(false);
  });

  it("several words → every word must match somewhere", () => {
    const f = searchFilter("esp32 cam")!;
    expect(f.startsWith("and(or(")).toBe(true);
    expect(f.match(/or\(/g)).toHaveLength(2);
  });

  it("an Arabic category word also matches the stored English category", () => {
    expect(searchFilter("حساسات")).toContain('category.in.("Sensors")');
  });
});
