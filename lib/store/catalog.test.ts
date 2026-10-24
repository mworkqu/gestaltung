import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  emptyState,
  hasActiveFilters,
  LEAD_FILTER_OPTIONS,
  leadClassesFor,
  parseStoreParams,
  resolveSort,
  searchFilter,
  searchTerms,
  sortOptions,
  storeQuery,
  STORE_URL_PARAMS,
} from "@/lib/store/catalog";
import { arrivesByDate } from "@/lib/store/delivery";
import { LEAD_TIME_CLASSES } from "@/lib/store/sourcing";
import { readFileSync } from "node:fs";

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

describe("activeFilterCount (badge on the mobile Filters button)", () => {
  it("counts drawer controls, never the search text", () => {
    expect(activeFilterCount(parseStoreParams({}))).toBe(0);
    expect(activeFilterCount(parseStoreParams({ q: "bolt" }))).toBe(0);
    expect(activeFilterCount(parseStoreParams({ category: "Sensors", stock: "2_4_weeks" }))).toBe(2);
    expect(activeFilterCount(parseStoreParams({ category: "Sensors", material: "Steel", stock: "1_2_weeks", sort: "price_asc" }))).toBe(4);
    expect(activeFilterCount(parseStoreParams({ q: "bolt", sort: "relevance" }))).toBe(0);
  });
});

describe("leadClassesFor (delivery-time options → lead_time_class, by computed arrival date)", () => {
  // Calendar-day settings (no holidays row): arrival = today + lead + 1 + 2 + 3.
  const slow = { handlingDays: 1, bufferDays: 3, standardTransitDays: 2 };
  const today = "2026-10-03";

  // The buckets are "Up to 2 weeks" (<= 14 days), "2-4 weeks" (15-28) and
  // "Over a month" (> 28), measured on the COMPUTED arrival date. The option
  // values are the old lead-class names, kept so shared ?stock= links survive.
  it("a product that arrives in 11 days is in the first bucket, not judged by its lead class (F-013)", () => {
    expect(arrivesByDate("3_5_days", slow, today)).toBe("2026-10-14");
    expect(leadClassesFor("3_5_days", slow, today)).toContain("3_5_days");
  });

  it("matches the date the card shows: each class lands in the bucket holding its arrival", () => {
    // in_stock 8 days, 3_5_days 11, 1_2_weeks 20, 2_4_weeks 34.
    expect(leadClassesFor("3_5_days", slow, today)).toEqual(["in_stock", "3_5_days"]);
    expect(leadClassesFor("1_2_weeks", slow, today)).toEqual(["1_2_weeks"]);
    // Open-ended, so a product past 28 days is still reachable from a filter
    // rather than only from "All".
    expect(leadClassesFor("2_4_weeks", slow, today)).toEqual(["2_4_weeks"]);
  });

  it("no bucket is empty with the live settings: the point of the relabel", () => {
    for (const o of LEAD_FILTER_OPTIONS) expect(leadClassesFor(o, slow, today).length).toBeGreaterThan(0);
  });

  it("no product falls outside every option, however slow the settings", () => {
    const verySlow = { handlingDays: 5, bufferDays: 10, standardTransitDays: 7 };
    const covered = LEAD_FILTER_OPTIONS.flatMap((o) => leadClassesFor(o, verySlow, today));
    for (const c of LEAD_TIME_CLASSES) expect(covered).toContain(c);
  });

  it("faster settings move products up a bucket, which is the owner's lever", () => {
    // handling 1 + transit 2 + buffer 1: in_stock 6, 3_5_days 9, 1_2_weeks 18.
    const fast = { handlingDays: 1, bufferDays: 1, standardTransitDays: 2 };
    expect(leadClassesFor("3_5_days", fast, today)).toEqual(["in_stock", "3_5_days"]);
    expect(leadClassesFor("1_2_weeks", fast, today)).toEqual(["1_2_weeks"]);
    expect(leadClassesFor("2_4_weeks", fast, today)).toEqual(["2_4_weeks"]);
  });

  it("every option is a disjoint range: no class is in two options", () => {
    const all = LEAD_FILTER_OPTIONS.flatMap((o) => leadClassesFor(o, slow, today));
    expect(new Set(all).size).toBe(all.length);
  });

  it("without shipping settings (no card shows a date) it falls back to the class's own range", () => {
    expect(leadClassesFor("3_5_days", null, today)).toEqual(["in_stock", "3_5_days", "1_2_weeks"]);
    expect(leadClassesFor("1_2_weeks", undefined, today)).toEqual(["2_4_weeks"]);
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

  it("before 0048 never names store_category (the column may not exist)", () => {
    expect(searchFilter("طابعة")).not.toContain("store_category");
    expect(searchFilter("esp32")).not.toContain("store_category");
  });

  it("after 0048 searches store_category too, and Arabic words match either column (C5)", () => {
    const f = searchFilter("طابعة", { storeCategory: true })!;
    expect(f).toContain("store_category.ilike.%طابعة%");
    expect(f).toContain('store_category.in.("3D printing")');
    expect(f).toContain('category.in.("3D printing")');
    const kits = searchFilter("أطقم", { storeCategory: true })!;
    expect(kits).toContain('category.in.("Kits")');
    const boards = searchFilter("متحكمات", { storeCategory: true })!;
    expect(boards).toContain("Boards and microcontrollers");
    expect(boards).toContain("Microcontrollers");
  });
});

describe("STORE_URL_PARAMS", () => {
  // Every param the listing reads must send /store to the dynamic search route,
  // or the static default listing would be served for a filtered URL.
  it("matches the /store rewrite list in next.config.mjs", () => {
    const config = readFileSync("next.config.mjs", "utf8");
    const m = config.match(/beforeFiles:\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const keys = [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect([...keys].sort()).toEqual([...STORE_URL_PARAMS].sort());
  });

  it("covers every key parseStoreParams reads", () => {
    const parsed = parseStoreParams(Object.fromEntries(STORE_URL_PARAMS.map((k) => [k, "1"])));
    expect(Object.keys(parsed).sort()).toEqual([...STORE_URL_PARAMS].sort());
  });
});