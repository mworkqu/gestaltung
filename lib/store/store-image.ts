// Server-only: copy a product image into the public `product-images` bucket
// as a web version (≤ 1600 px WebP) and a thumbnail (400 px WebP). Used for
// supplier API images so the store never hotlinks a supplier's site.

import sharp, { type Sharp } from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductImage } from "@/lib/google/drive-picker";
import { fetchWithinAllowList } from "@/lib/net/safe-fetch";
import { BUCKETS } from "@/lib/storage/paths";

const MAX_BYTES = 25 * 1024 * 1024;
/** Supplier product photos are small; anything bigger is refused unread. */
export const FETCH_MAX_BYTES = 15 * 1024 * 1024;

// Raster formats only (audit WEB-05): SVG would be decoded by librsvg inside
// sharp, so it is refused by content type, by magic bytes and by sharp's own
// format probe before any processing.
const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const SHARP_OPTIONS = { failOn: "error", limitInputPixels: 40e6 } as const;

/** True for a content-type header naming an allowed raster format. */
export function isRasterContentType(header: string | null): boolean {
  const type = (header ?? "").split(";")[0].trim().toLowerCase();
  return RASTER_TYPES.has(type);
}

/** Magic-byte check (JPEG, PNG, GIF, WebP, AVIF) so no other decoder is reached. */
export function looksLikeRaster(buf: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return true;
  if (ascii(0, 4) === "GIF8") return true;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return true;
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return true;
  return false;
}

/**
 * Opens a buffer with sharp only after confirming it is an allowed raster
 * image; throws "unsupported_format" otherwise.
 */
export async function openRaster(buf: Buffer): Promise<Sharp> {
  if (!looksLikeRaster(buf)) throw new Error("unsupported_format");
  const img = sharp(buf, SHARP_OPTIONS);
  const meta = await img.metadata();
  const ok =
    meta.format === "jpeg" ||
    meta.format === "png" ||
    meta.format === "webp" ||
    meta.format === "gif" ||
    (meta.format === "heif" && meta.compression === "av1");
  if (!ok) throw new Error("unsupported_format");
  return img;
}

export async function storeImage(
  supabase: SupabaseClient,
  buf: Buffer,
  stem: string,
  driveFileId: string | null = null
): Promise<ProductImage> {
  if (buf.length > MAX_BYTES) throw new Error("too_large");
  const base = (await openRaster(buf)).rotate();
  const [web, thumb] = await Promise.all([
    base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    base.clone().resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
  ]);
  const bucket = supabase.storage.from(BUCKETS.productImages);
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

/**
 * Downloads an image from one of the allowed hosts (no arbitrary fetches).
 * Every redirect hop must stay on an allowed host, only raster image types
 * are accepted, and the body is capped at FETCH_MAX_BYTES (API-08 / WEB-05).
 */
export async function fetchImage(
  url: string,
  allowedHosts: RegExp,
  fetchImpl: typeof fetch = fetch
): Promise<Buffer | null> {
  const res = await fetchWithinAllowList(url, {
    allowHost: (host) => allowedHosts.test(host),
    maxBytes: FETCH_MAX_BYTES,
    maxRedirects: 3,
    timeoutMs: 15_000,
    fetchImpl,
    init: { cache: "no-store" },
    accept: (r) => isRasterContentType(r.headers.get("content-type")),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(res.body);
  return looksLikeRaster(buf) ? buf : null;
}
