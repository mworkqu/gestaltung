import "server-only";
// The real sharp work for product images. Import this ONLY from API route
// handlers (app/api/**): Vercel bundles every page that shares a file into one
// function group, so any page that reached sharp (~20 MB with libvips) made
// ~160 page outputs 21 MB each. Pages call storeImage() from
// lib/store/store-image.ts, which POSTs to /api/admin/store-image instead.
// (sharp is installed as "sharp-admin" so Next's image optimizer does not find
// it either; see lib/store/load-sharp.ts and next.config.mjs SHARP_ROUTES.)

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductImage } from "@/lib/google/drive-picker";
import { loadSharp } from "@/lib/store/load-sharp";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Resizes to a <=1600 px WebP and a 400 px thumbnail and uploads both to `product-images`. */
export async function storeImage(
  supabase: SupabaseClient,
  buf: Buffer,
  stem: string,
  driveFileId: string | null = null
): Promise<ProductImage> {
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("too_large");
  const sharp = await loadSharp();
  const base = sharp(buf, { failOn: "none" }).rotate();
  const [web, thumb] = await Promise.all([
    base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    base.clone().resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
  ]);
  const bucket = supabase.storage.from("product-images");
  const up = await Promise.all([
    bucket.upload(`${stem}-web.webp`, web, { contentType: "image/webp", upsert: true, cacheControl: "31536000" }),
    bucket.upload(`${stem}-thumb.webp`, thumb, { contentType: "image/webp", upsert: true, cacheControl: "31536000" }),
  ]);
  const failed = up.find((u) => u.error);
  if (failed) throw new Error(`storage: ${failed.error!.message}`);
  return {
    path: `${stem}-web.webp`,
    web: bucket.getPublicUrl(`${stem}-web.webp`).data.publicUrl,
    thumb: bucket.getPublicUrl(`${stem}-thumb.webp`).data.publicUrl,
    drive_file_id: driveFileId,
  };
}
