import { describe, expect, it } from "vitest";

import { isAllowedPhotoHost, popoverPhoto, stockLine } from "./part-photo";

const own = "https://abc.supabase.co/storage/v1/object/public/product-images/p/x-thumb.webp";

describe("popoverPhoto", () => {
  it("prefers images[0].thumb from our bucket", () => {
    expect(popoverPhoto({ images: [{ thumb: own }], image_url: "https://evil.example/a.jpg" })).toBe(own);
  });
  it("accepts Voltaat (Shopify) and sizes it", () => {
    const r = popoverPhoto({ image_url: "https://cdn.shopify.com/s/files/1/a.jpg" }, 280);
    expect(r).toContain("width=280");
  });
  it("rejects other hosts and non-https", () => {
    expect(popoverPhoto({ image_url: "https://example.com/a.jpg" })).toBeNull();
    expect(popoverPhoto({ images: [{ thumb: "http://cdn.shopify.com/a.jpg" }] })).toBeNull();
    expect(isAllowedPhotoHost("not a url")).toBe(false);
  });
  it("null without a product", () => {
    expect(popoverPhoto(null)).toBeNull();
    expect(popoverPhoto({ images: "nope" })).toBeNull();
  });
});

describe("stockLine", () => {
  it("own stock → in stock; others sourced; none → unknown time", () => {
    expect(stockLine({ lead_time_class: "in_stock" })).toEqual({ kind: "in_stock" });
    expect(stockLine({ lead_time_class: "1_2_weeks" })).toEqual({ kind: "source", cls: "1_2_weeks" });
    expect(stockLine(null)).toEqual({ kind: "source", cls: null });
  });
});
