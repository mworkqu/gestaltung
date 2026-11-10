import { describe, expect, it } from "vitest";

import {
  CATALOG_TAG,
  catalogTagsFor,
  CRON_SKU_TAG_CAP,
  diffPartSnapshots,
  LISTING_FIELDS,
  LISTING_TAG,
  PART_SNAPSHOT_COLUMNS,
  partTag,
  type PartSnapshot,
} from "@/lib/cache/catalog-tags";
import { STORE_CARD_COLUMNS } from "@/lib/store/catalog";

const part = (id: string, extra: Partial<PartSnapshot> = {}): PartSnapshot => ({
  id,
  sku: `SKU-${id}`,
  backup_for: null,
  is_published: true,
  merged_into: null,
  name: `Part ${id}`,
  name_ar: null,
  unit_price: 10,
  image_url: "https://x/y.jpg",
  category: "Sensors",
  store_category: "Sensors and modules",
  material: null,
  lead_time_class: "in_stock",
  min_order_qty: 1,
  ...extra,
});

describe("diffPartSnapshots", () => {
  it("nothing touched -> nothing to refresh", () => {
    expect(diffPartSnapshots([], [part("a")], [part("a")])).toEqual({ skus: [], listingChanged: false });
  });

  it("an offer moved but no listed field did -> that product only", () => {
    // e.g. lead_time_days 7 -> 9 inside the same lead class: the delivery quote / source line may change
    expect(diffPartSnapshots(["a"], [part("a")], [part("a")])).toEqual({ skus: ["SKU-a"], listingChanged: false });
  });

  it.each([
    ["unit_price", 12.5],
    ["lead_time_class", "3_5_days"],
    ["lead_time_class", null],
    ["is_published", false],
    ["image_url", null],
    ["name", "Renamed"],
    ["min_order_qty", 5],
  ] as const)("a listed field (%s) moved -> product + listing", (field, value) => {
    expect(diffPartSnapshots(["a"], [part("a")], [part("a", { [field]: value })])).toEqual({ skus: ["SKU-a"], listingChanged: true });
  });

  it("numeric strings equal to numbers are not a change", () => {
    expect(diffPartSnapshots(["a"], [part("a", { unit_price: "10.00" as unknown as number })], [part("a", { unit_price: 10 })]).listingChanged).toBe(
      false,
    );
    expect(diffPartSnapshots(["a"], [part("a", { unit_price: "10" })], [part("a", { unit_price: 10 })]).listingChanged).toBe(false);
  });

  it("a product that appeared or disappeared changes the listing", () => {
    expect(diffPartSnapshots(["a"], [], [part("a")])).toEqual({ skus: ["SKU-a"], listingChanged: true });
    expect(diffPartSnapshots(["a"], [part("a")], [])).toEqual({ skus: ["SKU-a"], listingChanged: true });
  });

  it("a touched backup also refreshes the product it stands in for", () => {
    const main = part("m");
    const backup = part("b", { backup_for: "m" });
    expect(diffPartSnapshots(["b"], [backup, main], [backup, main])).toEqual({ skus: ["SKU-b", "SKU-m"], listingChanged: false });
  });

  it("de-duplicates and sorts SKUs", () => {
    expect(diffPartSnapshots(["b", "a", "b"], [part("a"), part("b")], [part("a"), part("b")]).skus).toEqual(["SKU-a", "SKU-b"]);
  });

  it("a touched product that could not be read -> unknown", () => {
    expect(diffPartSnapshots(["x"], [], [])).toEqual({ skus: [], listingChanged: true, unknown: true });
  });
});

describe("catalogTagsFor", () => {
  it("no change -> no tags", () => {
    expect(catalogTagsFor({ skus: [], listingChanged: false })).toEqual([]);
  });

  it("per-SKU tags, no listing tag when only product-page fields moved", () => {
    expect(catalogTagsFor({ skus: ["A", "B"], listingChanged: false })).toEqual(["part-A", "part-B"]);
  });

  it("listing tag first when a listed field moved", () => {
    expect(catalogTagsFor({ skus: ["A"], listingChanged: true })).toEqual([LISTING_TAG, "part-A"]);
  });

  it("at the cap: still per-SKU; past it: one full purge", () => {
    const skus = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);
    expect(catalogTagsFor({ skus: skus(CRON_SKU_TAG_CAP), listingChanged: true })).toHaveLength(CRON_SKU_TAG_CAP + 1);
    expect(catalogTagsFor({ skus: skus(CRON_SKU_TAG_CAP + 1), listingChanged: false })).toEqual([CATALOG_TAG]);
    expect(catalogTagsFor({ skus: ["A"], listingChanged: false }, 0)).toEqual([CATALOG_TAG]);
  });

  it("unknown -> one full purge", () => {
    expect(catalogTagsFor({ skus: [], listingChanged: true, unknown: true })).toEqual([CATALOG_TAG]);
  });

  it("tag names", () => {
    expect([CATALOG_TAG, LISTING_TAG, partTag("VLT-1")]).toEqual(["parts", "parts-listing", "part-VLT-1"]);
  });
});

describe("listing fields", () => {
  it("cover every card column except the ids", () => {
    const card = STORE_CARD_COLUMNS.split(",").map((c) => c.trim()).filter((c) => c !== "id" && c !== "sku");
    for (const c of card) expect(LISTING_FIELDS as readonly string[]).toContain(c);
  });

  it("are all in the snapshot select", () => {
    const cols = PART_SNAPSHOT_COLUMNS.split(",").map((c) => c.trim());
    for (const f of LISTING_FIELDS) expect(cols).toContain(f);
    expect(cols).toEqual(expect.arrayContaining(["id", "sku", "backup_for"]));
  });
});
