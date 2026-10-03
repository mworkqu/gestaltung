import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FALLBACK_STORE_CATEGORY,
  SOURCE_CATEGORY_DEFAULTS,
  STORE_CATEGORIES,
  isStoreCategory,
  storeCategoryForSource,
  storeCategoryOf,
} from "./store-categories";

const MIGRATION = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "0048_store_categories.sql"), "utf8");
const generated = MIGRATION.match(/-- BEGIN GENERATED MAPPING[\s\S]*?-- END GENERATED MAPPING/)?.[0] ?? "";
const tuples = (sql: string) => [...sql.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)].map((m) => [m[1], m[2]] as const);
const mapSql = generated.slice(generated.indexOf("insert into _m0048_map"));
const rulesSql = generated.slice(0, generated.indexOf("create temp table"));
const mapping = tuples(mapSql);

describe("store categories", () => {
  it("are the nine the owner approved, without Other", () => {
    expect(STORE_CATEGORIES).toHaveLength(9);
    expect(STORE_CATEGORIES).not.toContain("Other");
    expect(isStoreCategory("3D printing")).toBe(true);
    expect(isStoreCategory("Microcontrollers")).toBe(false);
    expect(isStoreCategory(null)).toBe(false);
  });

  it("rule fallback: a mapped source category gets its rule, anything else the fallback for review", () => {
    expect(storeCategoryForSource("Microcontrollers")).toEqual({ category: "Boards and microcontrollers", review: false });
    expect(storeCategoryForSource("3D printer parts")).toEqual({ category: "3D printing", review: false });
    expect(storeCategoryForSource(" Prototyping ")).toEqual({ category: "Cables and connectors", review: false });
    expect(storeCategoryForSource("Other")).toEqual({ category: FALLBACK_STORE_CATEGORY, review: true });
    expect(storeCategoryForSource("Something new")).toEqual({ category: "Tools and accessories", review: true });
    expect(storeCategoryForSource(null).review).toBe(true);
    for (const target of Object.values(SOURCE_CATEGORY_DEFAULTS)) expect(isStoreCategory(target)).toBe(true);
  });

  it("the storefront reads store_category, else the source category (before 0048)", () => {
    expect(storeCategoryOf({ category: "Microcontrollers", store_category: "Boards and microcontrollers" })).toBe("Boards and microcontrollers");
    expect(storeCategoryOf({ category: "Microcontrollers" })).toBe("Microcontrollers");
    expect(storeCategoryOf({ category: "Microcontrollers", store_category: null })).toBe("Microcontrollers");
    expect(storeCategoryOf({ category: null, store_category: "  " })).toBeNull();
  });
});

describe("0048 generated mapping", () => {
  it("covers the published catalogue with exactly the nine categories and no Other", () => {
    expect(mapping.length).toBeGreaterThan(1200);
    const used = new Set(mapping.map(([, c]) => c));
    expect([...used].sort()).toEqual([...STORE_CATEGORIES].sort());
    expect(used.has("Other")).toBe(false);
  });

  it("lists each SKU once and leaves the gift card out (0048 unpublishes it)", () => {
    const skus = mapping.map(([s]) => s);
    expect(new Set(skus).size).toBe(skus.length);
    expect(skus).not.toContain("VLT-44331994546493");
    expect(MIGRATION).toMatch(/update public\.parts set is_published = false\s+where sku = 'VLT-44331994546493'/);
  });

  it("puts every 3D product in 3D printing", () => {
    const bySku = new Map(mapping);
    for (const sku of ["VLT-52917969223997", "VLT-51998595973437", "VLT-51997019734333", "VLT-51441427218749", "VLT-50657528021309"]) {
      expect(bySku.get(sku)).toBe("3D printing");
    }
  });

  it("seeds store_category_rules with SOURCE_CATEGORY_DEFAULTS", () => {
    expect(Object.fromEntries(tuples(rulesSql))).toEqual(SOURCE_CATEGORY_DEFAULTS);
  });

  it("allows exactly the nine names in the check constraints", () => {
    const checks = [...MIGRATION.matchAll(/store_category in \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(checks.length).toBeGreaterThanOrEqual(2);
    for (const c of checks) expect(c.sort()).toEqual([...STORE_CATEGORIES].sort());
  });
});
