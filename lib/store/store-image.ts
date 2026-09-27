// Server-only: copy a product image into the public `product-images` bucket
// as a web version (≤ 1600 px WebP) and a thumbnail (400 px WebP). Used for
// supplier API images so the store never hotlinks a supplier's site.

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductImage } from "@/lib/google/drive-picker";

const MAX_BYTES = 25 * 1024 * 1024;

export async function storeImage(
  supabase: SupabaseClient,
  buf: Buffer,
  stem: string,
  driveFileId: string | null = null
): Promise<ProductImage> {
  if (buf.length > MAX_BYTES) throw new Error("too_large");
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

/** Downloads an image from one of the allowed hosts (no arbitrary fetches). */
export async function fetchImage(url: string, allowedHosts: RegExp): Promise<Buffer | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !allowedHosts.test(u.hostname)) return null;
  const res = await fetch(u, { signal: AbortSignal.timeout(15000), cache: "no-store" }).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  return Buffer.from(await res.arrayBuffer());
}
