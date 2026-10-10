import { describe, expect, it } from "vitest";

import { buildTiles, countConfirm, countFix, countReply, fixIssues, isLiveProduct, type FixPart } from "./home-tiles";
import { isTestId, isTestRow } from "./test-data";

describe("test data rules", () => {
  it("flags is_test, TEST in text, cleanup-list ids", () => {
    expect(isTestRow({ is_test: true })).toBe(true);
    expect(isTestRow({ texts: ["TEST LEAD (please ignore)"] })).toBe(true);
    expect(isTestRow({ texts: ["TEST-SERVO-5V"] })).toBe(true);
    expect(isTestRow({ texts: ["Nothing to see", "please delete"] })).toBe(true);
    expect(isTestRow({ id: "945ea389-9e83-4992-9161-628601ab7685" })).toBe(true);
    expect(isTestId("3CBF6A8C-232f-4eb2-a719-36b5754e96a1")).toBe(true);
  });
  it("keeps real rows", () => {
    expect(isTestRow({ texts: ["Continuity Test Probe", "Tester pen"] })).toBe(false);
    expect(isTestRow({ id: "aaaaaaaa-0000-0000-0000-000000000000", is_test: false })).toBe(false);
    expect(isTestRow({})).toBe(false);
  });
});

describe("Reply", () => {
  it("counts new, non-test messages only", () => {
    expect(
      countReply([
        { id: "1", status: "new", name: "Sara", message: "Hi" },
        { id: "2", status: "contacted", name: "Omar", message: "Hi" },
        { id: "3", status: "new", name: "TEST", message: "x" },
        { id: "4", status: "new", name: "A", message: "TEST callback (please ignore)" },
        { id: "5", status: "new", name: "B", message: "ok", is_test: true },
        { id: "2f1e6ed7-e202-4e81-b7c4-3cf6b157dcf1", status: "new", name: "C", message: "ok" },
      ])
    ).toBe(1);
  });
});

describe("Confirm", () => {
  it("counts orders waiting for the owner", () => {
    expect(
      countConfirm([
        { id: "a", status: "confirmed", customer_name: "Real" },
        { id: "b", status: "pending", customer_name: "Old" },
        { id: "c", status: "paid", customer_name: "Real 2" },
        { id: "d", status: "sourcing", customer_name: "Real 3" },
        { id: "e", status: "shipped", customer_name: "x" },
        { id: "f", status: "delivered", customer_name: "x" },
        { id: "g", status: "cancelled", customer_name: "x" },
        { id: "h", status: "confirmed", customer_name: "TEST — Claude — please delete" },
        { id: "i", status: "confirmed", customer_name: "Real", is_test: true },
        { id: "3cbf6a8c-232f-4eb2-a719-36b5754e96a1", status: "confirmed", customer_name: "Guest" },
      ])
    ).toBe(3);
  });
});

const ok: FixPart = {
  id: "p1",
  sku: "A-1",
  name: "Good part",
  is_published: true,
  unit_price: 12,
  image_url: "https://cdn.shopify.com/x.jpg",
  lead_time_class: "in_stock",
  hasSupplier: true,
};

describe("Fix", () => {
  it("lists what is missing", () => {
    expect(fixIssues(ok)).toEqual([]);
    expect(fixIssues({ ...ok, image_url: null })).toEqual(["photo"]);
    expect(fixIssues({ ...ok, image_url: null, images: [{ web: "https://x/y.webp" }] })).toEqual([]);
    expect(fixIssues({ ...ok, image_url: "[link removed]" })).toEqual(["photo"]);
    expect(fixIssues({ ...ok, unit_price: 0 })).toEqual(["price"]);
    expect(fixIssues({ ...ok, unit_price: null })).toEqual(["price"]);
    expect(fixIssues({ ...ok, hasSupplier: false, lead_time_class: null })).toEqual(["supplier", "delivery"]);
  });
  it("counts live products only", () => {
    const broken = { ...ok, lead_time_class: null };
    expect(
      countFix([
        ok,
        { ...broken, id: "p2" },
        { ...broken, id: "p3", is_published: false },
        { ...broken, id: "p4", merged_into: "p1" },
        { ...broken, id: "p5", is_test: true },
        { ...broken, id: "p6", name: "TEST product" },
        { ...broken, id: "p7", image_url: null, unit_price: 0 },
      ])
    ).toBe(2);
    expect(isLiveProduct({ ...ok, is_published: false })).toBe(false);
  });
});

describe("tiles", () => {
  it("are four, in order, with targets", () => {
    const tiles = buildTiles({ reply: 2, confirm: 1, buy: 5, fix: 0 });
    expect(tiles.map((t) => t.key)).toEqual(["reply", "confirm", "buy", "fix"]);
    expect(tiles.map((t) => t.count)).toEqual([2, 1, 5, 0]);
    expect(tiles.find((t) => t.key === "buy")?.href).toBe("/dashboard/store/stock");
    expect(tiles.find((t) => t.key === "fix")?.href).toBe("/dashboard/store/fix");
  });
});
