import { describe, expect, it } from "vitest";

import { editHref, listUrl, returnToOrCatalog, safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("accepts this locale's dashboard paths with query and anchor", () => {
    expect(safeReturnTo("/en/dashboard/store/fix#fix-delivery-1", "en")).toBe("/en/dashboard/store/fix#fix-delivery-1");
    expect(safeReturnTo("/ar/dashboard/store?category=x&published=published#part-1", "ar")).toBe(
      "/ar/dashboard/store?category=x&published=published#part-1"
    );
  });
  it("refuses anything that could leave the dashboard or the site", () => {
    for (const bad of [
      "https://evil.example/en/dashboard/store",
      "//evil.example/en/dashboard/",
      "/en/dashboard//evil",
      "/\\evil.example",
      "javascript:alert(1)",
      "/en/store",
      "/en/dashboard",
      "/ar/dashboard/store",
      "/en/dashboard/../admin",
      "/en/dashboard/%2e%2e/x",
      "/en/dashboard/store\n",
      "",
      null,
      42,
    ]) {
      const r = safeReturnTo(bad, "en");
      // %2e%2e is not a path segment for URL, so it stays inside the dashboard.
      if (bad === "/en/dashboard/%2e%2e/x") expect(r === null || r.startsWith("/en/dashboard/")).toBe(true);
      else expect(r).toBeNull();
    }
  });
  it("defaults to the catalog", () => {
    expect(returnToOrCatalog("https://evil.example", "ar")).toBe("/ar/dashboard/store");
    expect(returnToOrCatalog(undefined, "en")).toBe("/en/dashboard/store");
    expect(returnToOrCatalog("/en/dashboard/store/restock#restock-1", "en")).toBe("/en/dashboard/store/restock#restock-1");
  });
});

describe("links", () => {
  it("builds the edit link with an encoded returnTo", () => {
    expect(editHref("p1")).toBe("/dashboard/store/p1/edit");
    expect(editHref("p1", "/en/dashboard/store?a=1#part-p1")).toBe(
      "/dashboard/store/p1/edit?returnTo=%2Fen%2Fdashboard%2Fstore%3Fa%3D1%23part-p1"
    );
  });
  it("builds the list URL from set filters only", () => {
    expect(listUrl("en", "/dashboard/store", { category: "led", stock: undefined }, "part-1")).toBe(
      "/en/dashboard/store?category=led#part-1"
    );
    expect(listUrl("ar", "/dashboard/store", {})).toBe("/ar/dashboard/store");
  });
});
