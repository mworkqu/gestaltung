import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { MAX_INLINE_BYTES } from "@/lib/store/store-image";
import { MAX_IMAGE_BYTES, storeImage } from "@/lib/store/store-image-sharp";

// Server-to-server only: resizes a product image with sharp and uploads it to
// the product-images bucket. Pages call this (lib/store/store-image.ts) so that
// sharp lives in this one function instead of every page bundle. No browser
// use: no cookies, secret header required. Only inline bytes are accepted (no
// URL fetching here, so this route can never be used to reach other hosts);
// store-image-sharp refuses anything that is not a raster image (WEB-05).
export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET;
  const got = req.headers.get("x-internal-secret");
  if (!secret || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const KEY = /^[A-Za-z0-9/_\-.]+$/;
const Body = z.object({
  dataBase64: z.string().min(1),
  key: z
    .string()
    .min(1)
    .max(300)
    .refine((k) => KEY.test(k) && !k.includes("..")),
});

// base64 is 4/3 of the bytes, plus a little JSON around it.
const MAX_BODY_BYTES = Math.ceil((MAX_INLINE_BYTES * 4) / 3) + 1024;

export async function POST(req: Request) {
  if (!authorised(req)) return jsonError("unauthorized", 401);

  const parsed = await parseJsonBody(req, Body, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const { dataBase64, key } = parsed.data;

  const buf = Buffer.from(dataBase64, "base64");
  if (buf.length === 0) return jsonError("no_image", 400);
  if (buf.length > MAX_IMAGE_BYTES) return jsonError("too_large", 413);

  const db = createServiceClient();
  if (!db) return jsonError("storage_not_configured", 500);
  try {
    return jsonOk(await storeImage(db, buf, key));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return jsonError(msg === "unsupported_format" ? "unsupported_format" : "failed", msg === "unsupported_format" ? 415 : 500);
  }
}
