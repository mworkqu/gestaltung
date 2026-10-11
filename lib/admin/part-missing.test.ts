import { describe, expect, it } from "vitest";

import { hasGalleryPhoto, partMissing } from "./part-missing";

const full = {
  name: "LED",
  sku: "VLT-1",
  category: "Lights",
  unit_price: "2.5",
  image_url: "https://cdn.example/led.jpg",
};

describe("partMissing", () => {
  it("is empty when everything is there", () => {
    expect(partMissing(full)).toEqual([]);
  });
  it("lists blank required fields, price 0 and no photo, in form order", () => {
    expect(partMissing({ ...full, name: " ", sku: "", category: null, unit_price: "0", image_url: "" })).toEqual([
      "name",
      "sku",
      "category",
      "unit_price",
      "image_url",
    ]);
    expect(partMissing({ ...full, unit_price: "abc" })).toEqual(["unit_price"]);
    expect(partMissing({ ...full, image_url: "[link removed]" })).toEqual(["image_url"]);
  });
  it("a gallery photo counts; delivery comes from the caller", () => {
    expect(partMissing({ ...full, image_url: "", hasGalleryPhoto: true })).toEqual([]);
    expect(partMissing({ ...full, deliveryMissing: true })).toEqual(["delivery"]);
  });
  it("reads gallery photos like the Fix list", () => {
    expect(hasGalleryPhoto([{ web: "https://x/y.webp" }])).toBe(true);
    expect(hasGalleryPhoto([{ thumb: "x" }])).toBe(false);
    expect(hasGalleryPhoto(null)).toBe(false);
  });
});
