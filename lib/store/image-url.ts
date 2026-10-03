// Product photo sizing (Phase G). Most product photos are hotlinked from the
// Shopify CDN (Voltaat), which resizes on the fly from a `width` query param,
// so the page asks for the size it shows instead of a 1000 px original. Our own
// uploads (product-images bucket) exist as a 1600 px "-web.webp" and a 400 px
// "-thumb.webp"; small slots get the thumbnail. Every other host is returned
// unchanged (we cannot resize it). Plain <img>, no next/image: the free Vercel
// plan's image-optimisation quota is not spent on product photos.

/** The widths the storefront asks for, in device pixels. */
export const IMAGE_WIDTHS = {
  /** Product card (about 165–300 CSS px wide). */
  card: 600,
  /** Cart / BOM / project thumbnails (up to about 64 CSS px). */
  thumb: 140,
  /** Product page photo (up to about 600 CSS px wide). */
  gallery: 1000,
} as const;

/** `sizes` for a card image: 2 columns on phones, 3 from sm, 4 from lg (container max 1400 px). */
export const CARD_SIZES = "(min-width: 1024px) 320px, (min-width: 640px) 33vw, 50vw";
/** `sizes` for the product page photo: full width on phones, half the container from lg. */
export const GALLERY_SIZES = "(min-width: 1024px) 640px, 100vw";

const THUMB_MAX = 400;

function parse(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Shopify's image CDN (cdn.shopify.com and its subdomains): resizable by `?width=`. */
export function isShopifyCdn(url: string | null | undefined): boolean {
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return host === "cdn.shopify.com" || host.endsWith(".shopify.com");
}

/**
 * The URL of `url` at `width` device pixels where the host can resize, else
 * `url` itself. Shopify CDN: sets (or replaces) the `width` query param and
 * drops `height`/`crop` so the photo is never cropped. Our storage: the 400 px
 * thumbnail for widths up to 400. Null in, null out.
 */
export function sizedImage(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  const u = parse(url);
  if (!u) return url;
  const w = Math.max(1, Math.round(width));
  if (isShopifyCdn(url)) {
    u.searchParams.set("width", String(w));
    u.searchParams.delete("height");
    u.searchParams.delete("crop");
    return u.toString();
  }
  if (w <= THUMB_MAX && /\/storage\/v1\/object\/public\/product-images\/.+-web\.webp$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/-web\.webp$/, "-thumb.webp");
    return u.toString();
  }
  return url;
}

/**
 * A `srcset` with one candidate per width, or undefined when the host cannot
 * resize (then the plain `src` is all there is).
 */
export function sizedSrcSet(url: string | null | undefined, widths: readonly number[]): string | undefined {
  if (!url || !isShopifyCdn(url)) return undefined;
  return [...new Set(widths)]
    .sort((a, b) => a - b)
    .map((w) => `${sizedImage(url, w)} ${w}w`)
    .join(", ");
}
