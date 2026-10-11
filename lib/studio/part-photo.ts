// The photo shown in the Parts popover. Only pictures from our own store
// (product-images bucket) or Voltaat listings (Shopify CDN) are used; anything
// else, or no picture, means the popover shows the part's icon.

import { isShopifyCdn, sizedImage } from "@/lib/store/image-url";
import { partImageUrl } from "@/lib/parts/format";
import type { LeadTimeClass } from "@/lib/store/sourcing";

type PhotoProduct = { image_url?: string | null; images?: unknown; lead_time_class?: LeadTimeClass | null };

const OWN_BUCKET = /\/storage\/v1\/object\/public\/product-images\//;

/** Our own bucket or the Shopify CDN (Voltaat), https only. */
export function isAllowedPhotoHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return isShopifyCdn(url) || OWN_BUCKET.test(u.pathname);
  } catch {
    return false;
  }
}

/** parts.images[0].thumb (or .web) when allowed, else the listing's image_url resized; null when none. */
export function popoverPhoto(product: PhotoProduct | null | undefined, width = 280): string | null {
  if (!product) return null;
  const imgs = Array.isArray(product.images) ? product.images : [];
  for (const it of imgs) {
    if (it && typeof it === "object") {
      const o = it as { thumb?: unknown; web?: unknown };
      for (const c of [o.thumb, o.web]) {
        if (typeof c === "string" && isAllowedPhotoHost(c)) return sizedImage(c, width);
      }
    }
  }
  const main = partImageUrl({ image_url: product.image_url ?? null });
  return main && isAllowedPhotoHost(main) ? sizedImage(main, width) : null;
}

export type StockLine = { kind: "in_stock" } | { kind: "source"; cls: LeadTimeClass | null };

/**
 * Own stock first: a product we hold ("in_stock" lead class) is "In stock in
 * Lusail"; any other class is sourced with that class's time; no store
 * product / no class = we source it and confirm the time.
 */
export function stockLine(product: Pick<PhotoProduct, "lead_time_class"> | null | undefined): StockLine {
  const cls = product?.lead_time_class ?? null;
  return cls === "in_stock" ? { kind: "in_stock" } : { kind: "source", cls };
}
