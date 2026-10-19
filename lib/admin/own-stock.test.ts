import { describe, expect, it } from "vitest";

import {
  SHELF_QTY_MAX,
  allShelfRows,
  isMirror,
  onShelfRows,
  parseShelfQty,
  searchShelfRows,
  shelfPlan,
  type ShelfRow,
} from "@/lib/admin/own-stock";
import type { StockBucket, StockItem, StockLists } from "@/lib/admin/stock-lists";

function item(
  id: string,
  name: string,
  sku: string,
  ownQty: number,
  bucket: StockBucket = "buy",
  pricingMode: string | null = "markup"
): StockItem {
  return {
    part: {
      id,
      sku,
      name,
      photo: null,
      price: 10,
      landedCost: null,
      supplier: null,
      supplierSku: null,
      supplierUrl: null,
      moq: 1,
      leadTimeClass: null,
      ownQty,
      pricingMode,
    },
    bucket,
    interest: { cartPeople: 0, requestPeople: 0, requestedQty: 0, olderSignals: 0, views: 0 },
    qty: 1,
  };
}

const lists: StockLists = {
  buy: [item("1", "Soil moisture sensor", "VLT-1", 0)],
  watch: [item("2", "ESP32 DevKit", "VLT-2", 4, "watch", "mirror")],
  dont: [item("3", "Brass hex nut M3", "DK-3", 12, "dont"), item("4", "Zip ties", "VLT-4", 0, "dont")],
};

describe("parseShelfQty", () => {
  it("accepts whole numbers including zero", () => {
    expect(parseShelfQty("0")).toBe(0);
    expect(parseShelfQty("42")).toBe(42);
    expect(parseShelfQty(7)).toBe(7);
    expect(parseShelfQty("  12  ")).toBe(12);
    expect(parseShelfQty(String(SHELF_QTY_MAX))).toBe(SHELF_QTY_MAX);
  });

  it("rejects anything that is not a plain count, so a typo never empties the shelf", () => {
    for (const bad of ["", "   ", "-5", "-0", "3.5", "1e3", "abc", "12 units", "٤", null, undefined, {}]) {
      expect(parseShelfQty(bad)).toBeNull();
    }
    expect(parseShelfQty(SHELF_QTY_MAX + 1)).toBeNull();
  });
});

describe("isMirror", () => {
  it("reads parts.pricing_mode", () => {
    expect(isMirror("mirror")).toBe(true);
    expect(isMirror("MIRROR")).toBe(true);
    expect(isMirror("markup")).toBe(false);
    expect(isMirror(null)).toBe(false);
    expect(isMirror(undefined)).toBe(false);
  });
});

describe("shelfPlan", () => {
  it("gives the own-stock offer above zero", () => {
    expect(shelfPlan(1)).toEqual({ qty: 1, giveOwnOffer: true, parkOwnOffer: false, fixPrice: false });
    expect(shelfPlan(250)).toEqual({ qty: 250, giveOwnOffer: true, parkOwnOffer: false, fixPrice: false });
  });

  it("parks the offer at zero instead of deleting it", () => {
    expect(shelfPlan(0)).toEqual({ qty: 0, giveOwnOffer: false, parkOwnOffer: true, fixPrice: false });
  });

  // 0095 only lets an offer with a retail price whose supplier has a
  // commission win for a mirror product, and own stock has neither, so the
  // offer would be written and silently ignored.
  it("fixes the price of a mirror product when stock goes on the shelf", () => {
    expect(shelfPlan(5, { mirror: true })).toEqual({ qty: 5, giveOwnOffer: true, parkOwnOffer: false, fixPrice: true });
  });

  it("leaves the price alone at zero, so it never starts following Voltaat again", () => {
    expect(shelfPlan(0, { mirror: true }).fixPrice).toBe(false);
  });

  it("does not touch a product that already sets its own price", () => {
    expect(shelfPlan(5, { mirror: false }).fixPrice).toBe(false);
  });
});

describe("allShelfRows", () => {
  it("takes every product of the three lists, sorted by name", () => {
    expect(allShelfRows(lists).map((r) => r.name)).toEqual([
      "Brass hex nut M3",
      "ESP32 DevKit",
      "Soil moisture sensor",
      "Zip ties",
    ]);
  });

  it("carries the shelf count of each product", () => {
    const rows = allShelfRows(lists);
    expect(rows.find((r) => r.id === "2")).toEqual<ShelfRow>({
      id: "2",
      sku: "VLT-2",
      name: "ESP32 DevKit",
      qty: 4,
      price: 10,
      mirror: true,
    });
  });
});

describe("onShelfRows", () => {
  it("keeps only what we hold", () => {
    expect(onShelfRows(lists).map((r) => r.id)).toEqual(["3", "2"]);
  });

  it("is empty when nothing is held", () => {
    expect(onShelfRows({ buy: [item("9", "Nothing", "X", 0)], watch: [], dont: [] })).toEqual([]);
  });
});

describe("searchShelfRows", () => {
  const rows = allShelfRows(lists);

  it("matches name or SKU, case-insensitively", () => {
    expect(searchShelfRows(rows, "esp32").map((r) => r.id)).toEqual(["2"]);
    expect(searchShelfRows(rows, "DK-").map((r) => r.id)).toEqual(["3"]);
    expect(searchShelfRows(rows, "vlt-").map((r) => r.id)).toEqual(["2", "1", "4"]);
  });

  it("finds products that are not on the Buy list", () => {
    expect(searchShelfRows(rows, "zip").map((r) => r.id)).toEqual(["4"]);
  });

  it("returns nothing for a blank query, so the shelf list shows instead", () => {
    expect(searchShelfRows(rows, "")).toEqual([]);
    expect(searchShelfRows(rows, "   ")).toEqual([]);
  });

  it("caps the number of hits", () => {
    expect(searchShelfRows(rows, "e", 2)).toHaveLength(2);
    expect(searchShelfRows(rows, "e", 0)).toEqual([]);
  });
});
