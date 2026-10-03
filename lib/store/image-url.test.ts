import { describe, expect, it } from "vitest";

import { isShopifyCdn, sizedImage, sizedSrcSet } from "./image-url";

const SHOPIFY = "https://cdn.shopify.com/s/files/1/0567/files/esp32.jpg?v=1700000000&width=1000";

describe("sizedImage", () => {
  it("replaces the width on Shopify CDN URLs and keeps other params", () => {
    const out = new URL(sizedImage(SHOPIFY, 600)!);
    expect(out.hostname).toBe("cdn.shopify.com");
    expect(out.searchParams.get("width")).toBe("600");
    expect(out.searchParams.get("v")).toBe("1700000000");
  });

  it("adds a width when there is none and drops height/crop", () => {
    const out = new URL(sizedImage("https://cdn.shopify.com/a.png?height=500&crop=center", 140)!);
    expect(out.searchParams.get("width")).toBe("140");
    expect(out.searchParams.has("height")).toBe(false);
    expect(out.searchParams.has("crop")).toBe(false);
  });

  it("treats shop subdomains of shopify.com as the CDN", () => {
    expect(isShopifyCdn("https://images.shopify.com/x.jpg")).toBe(true);
    expect(isShopifyCdn("https://voltaat.myshopify.com/x.jpg")).toBe(false);
    expect(isShopifyCdn("https://shopify.com.evil.example/x.jpg")).toBe(false);
  });

  it("leaves other hosts unchanged", () => {
    const u = "https://www.digikey.com/photo.jpg?width=1000";
    expect(sizedImage(u, 600)).toBe(u);
    expect(sizedImage("https://drive.google.com/uc?export=view&id=abc", 140)).toBe(
      "https://drive.google.com/uc?export=view&id=abc",
    );
  });

  it("uses our 400 px thumbnail for small slots only", () => {
    const web = "https://x.supabase.co/storage/v1/object/public/product-images/a/b-web.webp";
    expect(sizedImage(web, 140)).toBe("https://x.supabase.co/storage/v1/object/public/product-images/a/b-thumb.webp");
    expect(sizedImage(web, 600)).toBe(web);
  });

  it("passes null and unparseable values through", () => {
    expect(sizedImage(null, 600)).toBeNull();
    expect(sizedImage("", 600)).toBeNull();
    expect(sizedImage("not a url", 600)).toBe("not a url");
  });
});

describe("sizedSrcSet", () => {
  it("lists each width once, ascending, for Shopify URLs", () => {
    const set = sizedSrcSet(SHOPIFY, [600, 300, 600])!;
    const parts = set.split(", ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/width=300 300w$/);
    expect(parts[1]).toMatch(/width=600 600w$/);
  });

  it("is undefined for hosts that cannot resize", () => {
    expect(sizedSrcSet("https://example.com/a.jpg", [300, 600])).toBeUndefined();
    expect(sizedSrcSet(null, [300])).toBeUndefined();
  });
});
