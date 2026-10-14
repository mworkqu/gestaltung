import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { fetchImage } from "@/lib/store/store-image";
import { MAX_IMAGE_BYTES, storeImage } from "@/lib/store/store-image-sharp";

// Server-to-server only: resizes a product image with sharp and uploads it to
// the product-images bucket. Pages call this (lib/store/store-image.ts) so that
// sharp lives in this one function instead of every page bundle. No browser
// use: no cookies, secret header required.
export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET ?? process.env.CRON_SECRET;
  const got = req.headers.get("x-internal-secret");
  if (!secret || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { sourceUrl?: unknown; dataBase64?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : "";
  if (!key || key.length > 300 || key.includes("..") || !/^[A-Za-z0-9/_\-.]+$/.test(key)) {
    return NextResponse.json({ error: "bad_key" }, { status: 400 });
  }

  let buf: Buffer | null = null;
  if (typeof body.dataBase64 === "string" && body.dataBase64) {
    buf = Buffer.from(body.dataBase64, "base64");
  } else if (typeof body.sourceUrl === "string" && body.sourceUrl) {
    // https only, and never localhost or a literal IP.
    buf = await fetchImage(body.sourceUrl, /^(?!localhost$)(?![\d.]+$)[a-z0-9-]+(\.[a-z0-9-]+)+$/i);
  }
  if (!buf || buf.length === 0) return NextResponse.json({ error: "no_image" }, { status: 400 });
  if (buf.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "storage_not_configured" }, { status: 500 });
  try {
    return NextResponse.json(await storeImage(db, buf, key));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
