import { describe, expect, it } from "vitest";

import {
  buildProductList,
  parseProductEdit,
  UNCATEGORISED,
  type ProductPartRow,
} from "@/lib/mobile/products";

const OWN = "https://abc.supabase.co/storage/v1/object/public/product-images/p/x-thumb.webp";

const part = (over: Partial<ProductPartRow> = {}): ProductPartRow => ({
  id: "p1",
  sku: "SKU1",
  name: "Servo",
  category: "motors",
  store_category: null,
  unit_price: 100,
  landed_cost_qar: 60,
  stock_status: "in_stock",
  is_published: true,
  in_own_stock: true,
  merged_into: null,
  is_test: null,
  image_url: null,
  images: null,
  lead_time_class: "in_stock",
  ...over,
});

describe("product list", () => {
  it("offers every category with its count, uncategorised last", () => {
    const list = buildProductList({
      parts: [
        part({ id: "a", category: "motors" }),
        part({ id: "b", category: "3d printers" }),
        part({ id: "c", category: "3d printers" }),
        part({ id: "d", category: null }),
      ],
      ownStock: [],
      category: null,
      limit: 100,
    });
    expect(list.categories).toEqual([
      { key: "3d printers", label: "3d printers", count: 2 },
      { key: "motors", label: "motors", count: 1 },
      { key: UNCATEGORISED, label: "Uncategorised", count: 1 },
    ]);
  });

  it("shows only the chosen category, and says how many there are in all", () => {
    const list = buildProductList({
      parts: [
        part({ id: "a", name: "Zebra", category: "motors" }),
        part({ id: "b", name: "Alpha", category: "motors" }),
        part({ id: "c", category: "3d printers" }),
      ],
      ownStock: [],
      category: "motors",
      limit: 1,
    });
    expect(list.total).toBe(2);
    // Sorted by name, so the cap keeps the first alphabetically, not whichever
    // row the database happened to return first.
    expect(list.items.map((i) => i.name)).toEqual(["Alpha"]);
  });

  it("treats a category as one however it was capitalised", () => {
    const list = buildProductList({
      parts: [part({ id: "a", category: "Motors" }), part({ id: "b", category: "motors" })],
      ownStock: [],
      category: "motors",
      limit: 100,
    });
    expect(list.total).toBe(2);
    expect(list.categories).toHaveLength(1);
  });

  it("prefers the store category over the old one", () => {
    const list = buildProductList({
      parts: [part({ category: "motors", store_category: "Servos" })],
      ownStock: [],
      category: null,
      limit: 100,
    });
    expect(list.items[0].category).toBe("Servos");
    expect(list.items[0].categoryKey).toBe("servos");
  });

  it("leaves merged duplicates and test rows out", () => {
    const list = buildProductList({
      parts: [part({ id: "a" }), part({ id: "b", merged_into: "a" }), part({ id: "c", is_test: true })],
      ownStock: [],
      category: null,
      limit: 100,
    });
    expect(list.total).toBe(1);
  });

  it("separates no price from a price of zero, and no shelf from an empty shelf", () => {
    const list = buildProductList({
      parts: [
        part({ id: "a", unit_price: null, landed_cost_qar: null, in_own_stock: false }),
        part({ id: "b", unit_price: 0, in_own_stock: true }),
      ],
      ownStock: [],
      category: null,
      limit: 100,
    });
    const [a, b] = list.items;
    expect(a.price).toBeNull();
    expect(a.cost).toBeNull();
    expect(a.stock).toBeNull();
    expect(b.price).toBe(0);
    expect(b.stock).toBe(0);
  });

  it("reads a price that arrives as a string", () => {
    const list = buildProductList({ parts: [part({ unit_price: "12.50" })], ownStock: [], category: null, limit: 100 });
    expect(list.items[0].price).toBe(12.5);
  });

  it("counts the shelf for a product we hold", () => {
    const list = buildProductList({
      parts: [part({ id: "a", in_own_stock: true })],
      ownStock: [{ part_id: "a", qty: "7" }],
      category: null,
      limit: 100,
    });
    expect(list.items[0].stock).toBe(7);
  });

  it("marks an unpublished product as a draft", () => {
    const list = buildProductList({
      parts: [part({ is_published: false, stock_status: "in_stock" })],
      ownStock: [],
      category: null,
      limit: 100,
    });
    expect(list.items[0].status).toBe("draft");
    expect(list.items[0].published).toBe(false);
  });

  it("passes a picture through only from a host we allow", () => {
    const allowed = buildProductList({ parts: [part({ images: [{ thumb: OWN }] })], ownStock: [], category: null, limit: 100 });
    expect(allowed.items[0].photo).toContain("product-images");

    const refused = buildProductList({
      parts: [part({ images: [{ thumb: "https://evil.example/a.jpg" }], image_url: "http://cdn.shopify.com/a.jpg" })],
      ownStock: [],
      category: null,
      limit: 100,
    });
    expect(refused.items[0].photo).toBeNull();
  });

  it("answers with nothing for a category that does not exist", () => {
    const list = buildProductList({ parts: [part()], ownStock: [], category: "no-such-thing", limit: 100 });
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
    // The picker is still offered, so the app can get back out again.
    expect(list.categories).toHaveLength(1);
  });

  it("falls back to the sku, then to a placeholder, for a nameless product", () => {
    const list = buildProductList({
      parts: [part({ id: "a", name: null, sku: "SKU9" }), part({ id: "b", name: null, sku: null })],
      ownStock: [],
      category: null,
      limit: 100,
    });
    expect(list.items.map((i) => i.name).sort()).toEqual(["SKU9", "Untitled product"]);
  });
});

describe("product edit", () => {
  it("takes a name, a price, or both", () => {
    expect(parseProductEdit({ partId: "p1", name: "  Servo HS-422 " })).toEqual({
      ok: true,
      value: { partId: "p1", name: "Servo HS-422" },
    });
    expect(parseProductEdit({ partId: "p1", unitPrice: 12.5 })).toEqual({
      ok: true,
      value: { partId: "p1", unitPrice: 12.5 },
    });
    expect(parseProductEdit({ partId: "p1", name: "X", unitPrice: 1 })).toEqual({
      ok: true,
      value: { partId: "p1", name: "X", unitPrice: 1 },
    });
  });

  it("rounds a price to two decimals", () => {
    expect(parseProductEdit({ partId: "p1", unitPrice: 1.239 })).toEqual({ ok: true, value: { partId: "p1", unitPrice: 1.24 } });
    expect(parseProductEdit({ partId: "p1", unitPrice: 1.231 })).toEqual({ ok: true, value: { partId: "p1", unitPrice: 1.23 } });
    // A third decimal that a double cannot hold exactly (1.005 is really
    // 1.00499…) rounds down, because that is the number we were handed.
    expect(parseProductEdit({ partId: "p1", unitPrice: 1.005 })).toEqual({ ok: true, value: { partId: "p1", unitPrice: 1 } });
  });

  it("reads a price sent as a string", () => {
    expect(parseProductEdit({ partId: "p1", unitPrice: "20" })).toEqual({ ok: true, value: { partId: "p1", unitPrice: 20 } });
  });

  it("allows a price of zero", () => {
    expect(parseProductEdit({ partId: "p1", unitPrice: 0 })).toEqual({ ok: true, value: { partId: "p1", unitPrice: 0 } });
  });

  it("refuses an edit that changes nothing", () => {
    expect(parseProductEdit({ partId: "p1" })).toEqual({ ok: false, error: "nothing_to_change" });
  });

  it("refuses a blank or oversized name", () => {
    expect(parseProductEdit({ partId: "p1", name: "   " })).toEqual({ ok: false, error: "name" });
    expect(parseProductEdit({ partId: "p1", name: "x".repeat(201) })).toEqual({ ok: false, error: "name" });
  });

  it("refuses a price that is negative, absurd or not a number", () => {
    expect(parseProductEdit({ partId: "p1", unitPrice: -1 })).toEqual({ ok: false, error: "unitPrice" });
    expect(parseProductEdit({ partId: "p1", unitPrice: 1e9 })).toEqual({ ok: false, error: "unitPrice" });
    expect(parseProductEdit({ partId: "p1", unitPrice: "free" })).toEqual({ ok: false, error: "unitPrice" });
    expect(parseProductEdit({ partId: "p1", unitPrice: Number.POSITIVE_INFINITY })).toEqual({ ok: false, error: "unitPrice" });
  });

  it("refuses a missing or junk id, and a body that is not an object", () => {
    expect(parseProductEdit({ name: "X" })).toEqual({ ok: false, error: "partId" });
    expect(parseProductEdit({ partId: "x".repeat(65), name: "X" })).toEqual({ ok: false, error: "partId" });
    expect(parseProductEdit(null)).toEqual({ ok: false, error: "body" });
    expect(parseProductEdit("p1")).toEqual({ ok: false, error: "body" });
  });

  it("ignores a field it does not know rather than writing it", () => {
    const parsed = parseProductEdit({ partId: "p1", name: "X", is_published: true, category: "hacked" });
    expect(parsed).toEqual({ ok: true, value: { partId: "p1", name: "X" } });
  });
});
