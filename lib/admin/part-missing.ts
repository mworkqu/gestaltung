// What the product edit form still misses (D1 item 5): the required fields
// plus what the Fix list asks for (photo, price > 0, delivery date). Drives the
// sticky "What's missing" summary and the red fields. Pure.

export const MISSING_KEYS = ["name", "sku", "category", "unit_price", "image_url", "delivery"] as const;
export type MissingKey = (typeof MISSING_KEYS)[number];

export type PartMissingInput = {
  name?: string | null;
  sku?: string | null;
  category?: string | null;
  unit_price?: string | number | null;
  image_url?: string | null;
  /** A gallery photo (parts.images[].web) counts as a photo. */
  hasGalleryPhoto?: boolean;
  /** lead_time_class is null and the product is not marked "on request". */
  deliveryMissing?: boolean;
};

const blank = (v: unknown) => String(v ?? "").trim() === "";

export function partMissing(p: PartMissingInput): MissingKey[] {
  const out: MissingKey[] = [];
  if (blank(p.name)) out.push("name");
  if (blank(p.sku)) out.push("sku");
  if (blank(p.category)) out.push("category");
  const price = Number(String(p.unit_price ?? "").trim());
  if (blank(p.unit_price) || !Number.isFinite(price) || price <= 0) out.push("unit_price");
  const url = String(p.image_url ?? "").trim();
  if (!p.hasGalleryPhoto && !/^https?:\/\//i.test(url)) out.push("image_url");
  if (p.deliveryMissing) out.push("delivery");
  return out;
}

/** Same rule as the Fix list's photo check (lib/admin/home-tiles.ts hasPhoto). */
export function hasGalleryPhoto(images: unknown): boolean {
  return Array.isArray(images) && images.some((im) => !!im && typeof im === "object" && !!(im as { web?: unknown }).web);
}
