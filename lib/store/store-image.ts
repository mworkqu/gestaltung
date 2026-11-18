// Server-only: copy a product image into the public `product-images` bucket
// as a web version (≤ 1600 px WebP) and a thumbnail (400 px WebP). Used for
// supplier API images so the store never hotlinks a supplier's site.
//
// This module must stay free of sharp: pages (server actions) import it, and
// anything sharp-heavy that a page reaches is duplicated into every page
// function bundle on Vercel. The resize happens in the internal route
// /api/admin/store-image (lib/store/store-image-sharp.ts). API routes can call
// store-image-sharp directly and skip the HTTP hop.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductImage } from "@/lib/google/drive-picker";
import { fetchWithinAllowList } from "@/lib/net/safe-fetch";

/** Supplier product photos are small; anything bigger is refused unread. */
export const FETCH_MAX_BYTES = 15 * 1024 * 1024;

// Raster formats only (audit WEB-05): SVG would be decoded by librsvg inside
// sharp, so it is refused by content type, by magic bytes and by sharp's own
// format probe (store-image-sharp.ts openRaster) before any processing.
const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

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

/** Vercel rejects request bodies over 4.5 MB; base64 adds a third. */
export const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

type Env = Record<string, string | undefined>;

export function internalBaseUrl(env: Env = process.env): string {
  return env.NEXT_PUBLIC_SITE_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");
}

export function internalSecret(env: Env = process.env): string | null {
  return env.INTERNAL_API_SECRET || env.CRON_SECRET || null;
}

/** URL, headers and body for POST /api/admin/store-image. Null when no secret is configured. */
export function buildStoreImageRequest(
  buf: Buffer,
  key: string,
  env: Env = process.env
): { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } } | null {
  const secret = internalSecret(env);
  if (!secret) return null;
  return {
    url: `${internalBaseUrl(env).replace(/\/+$/, "")}/api/admin/store-image`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ dataBase64: buf.toString("base64"), key }),
    },
  };
}

/**
 * Stores a product image via the internal sharp route. Throws
 * "unsupported_format" for anything that is not a raster image (WEB-05);
 * returns null (the caller keeps the product without a photo) when the route
 * cannot be reached.
 */
export async function storeImage(
  _supabase: SupabaseClient,
  buf: Buffer,
  stem: string,
  driveFileId: string | null = null
): Promise<ProductImage | null> {
  if (!looksLikeRaster(buf)) throw new Error("unsupported_format");
  const warn = () =>
    console.warn("[store-image] internal route unavailable (preview deployments are SSO-protected); product saved without photo");
  const req = buf.length > MAX_INLINE_BYTES ? null : buildStoreImageRequest(buf, stem);
  if (!req) {
    warn();
    return null;
  }
  try {
    const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const img = (await res.json()) as ProductImage;
    if (!img?.path || !img.web || !img.thumb) throw new Error("bad response");
    return { ...img, drive_file_id: driveFileId };
  } catch {
    warn();
    return null;
  }
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
