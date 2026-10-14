// Server-only: copy a product image into the public `product-images` bucket
// as a web version (<= 1600 px WebP) and a thumbnail (400 px WebP). Used for
// supplier API images so the store never hotlinks a supplier's site.
//
// This module must stay free of sharp: pages (server actions) import it, and
// anything sharp-heavy that a page reaches is duplicated into every page
// function bundle on Vercel. The resize happens in the internal route
// /api/admin/store-image (lib/store/store-image-sharp.ts). API routes can call
// store-image-sharp directly and skip the HTTP hop.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductImage } from "@/lib/google/drive-picker";

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
 * Stores a product image via the internal sharp route. Returns null (the
 * caller keeps the product without a photo) when the route cannot be reached.
 */
export async function storeImage(
  _supabase: SupabaseClient,
  buf: Buffer,
  stem: string,
  driveFileId: string | null = null
): Promise<ProductImage | null> {
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
