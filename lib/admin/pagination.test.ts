import { describe, expect, it } from "vitest";

import { LIST_PAGE_SIZE, matchesQuery, pageQuery, paginate, parsePage } from "@/lib/admin/pagination";

const rows = Array.from({ length: 250 }, (_, i) => i + 1);

describe("parsePage", () => {
  it("reads whole numbers >= 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["2", "9"])).toBe(2);
  });
  it("falls back to 1 for anything else", () => {
    for (const v of [undefined, "", "0", "-1", "2.5", "abc", "1e3", "99999999999999999999"]) expect(parsePage(v), String(v)).toBe(1);
  });
});

describe("paginate", () => {
  it("uses 100 rows per page", () => {
    expect(LIST_PAGE_SIZE).toBe(100);
    const p = paginate(rows, 1);
    expect(p.items).toHaveLength(100);
    expect(p).toMatchObject({ page: 1, pages: 3, total: 250, from: 1, to: 100 });
  });
  it("returns the last partial page", () => {
    const p = paginate(rows, 3);
    expect(p.items).toEqual(rows.slice(200));
    expect(p).toMatchObject({ page: 3, from: 201, to: 250 });
  });
  it("clamps a page past the end to the last page", () => {
    expect(paginate(rows, 40).page).toBe(3);
    expect(paginate(rows, 0).page).toBe(1);
  });
  it("handles an empty list", () => {
    expect(paginate([], 5)).toEqual({ items: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
  });
  it("keeps 100 rows or fewer on one page", () => {
    expect(paginate(rows.slice(0, 100), 1).pages).toBe(1);
    expect(paginate(rows.slice(0, 101), 1).pages).toBe(2);
  });
});

describe("pageQuery", () => {
  it("keeps search and filters and sets the page", () => {
    expect(pageQuery({ q: "relay", category: "sensors", page: "1" }, 2)).toEqual({ q: "relay", category: "sensors", page: "2" });
  });
  it("drops page=1 and empty values", () => {
    expect(pageQuery({ q: "", stock: undefined, published: "published", page: "3" }, 1)).toEqual({ published: "published" });
  });
  it("keeps repeated params", () => {
    expect(pageQuery({ tag: ["a", "", "b"] }, 2)).toEqual({ tag: ["a", "b"], page: "2" });
  });
});

describe("matchesQuery", () => {
  it("matches any field, case-insensitive", () => {
    expect(matchesQuery("uno", ["Arduino UNO R3", null])).toBe(true);
    expect(matchesQuery("VLT-12", [null, "vlt-123"])).toBe(true);
    expect(matchesQuery("relay", ["Servo"])).toBe(false);
  });
  it("lets everything through on a blank search", () => {
    expect(matchesQuery(undefined, [])).toBe(true);
    expect(matchesQuery("   ", ["x"])).toBe(true);
  });
});
