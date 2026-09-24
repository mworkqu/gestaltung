import sharp from "sharp";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";

// Copies Google Drive images (picked in the admin) into Supabase Storage
// (Task 17b). Never hotlinks Drive. For each file: download with the owner's
// short-lived drive.file token, make a web version (≤ 1600 px WebP) and a
// thumbnail (400 px WebP), upload both to the public `product-images` bucket
// (0029), and return their URLs with the Drive file id for traceability.
// super_admin only (checked here and by the bucket policy).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{10,200}$/;

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    files?: { id?: unknown; name?: unknown }[];
  } | null;
  const token = typeof body?.token === "string" ? body.token : null;
  const files = (body?.files ?? [])
    .filter((f) => typeof f.id === "string" && ID.test(f.id))
    .slice(0, 8)
    .map((f) => ({ id: f.id as string, name: typeof f.name === "string" ? f.name.slice(0, 200) : (f.id as string) }));
  if (!token || !files.length) return new Response(null, { status: 400 });

  const supabase = await createClient();
  const bucket = supabase.storage.from("product-images");

  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return { name: f.name, error: `drive_${res.status}` };
        const type = res.headers.get("content-type") ?? "";
        if (!type.startsWith("image/")) return { name: f.name, error: "not_image" };
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BYTES) return { name: f.name, error: "too_large" };

        const base = sharp(buf, { failOn: "none" }).rotate();
        const [web, thumb] = await Promise.all([
          base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
          base.clone().resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
        ]);

        const stem = `drive/${f.id}/${Date.now()}`;
        const up = await Promise.all([
          bucket.upload(`${stem}-web.webp`, web, { contentType: "image/webp", upsert: true, cacheControl: "31536000" }),
          bucket.upload(`${stem}-thumb.webp`, thumb, { contentType: "image/webp", upsert: true, cacheControl: "31536000" }),
        ]);
        const failed = up.find((u) => u.error);
        if (failed) return { name: f.name, error: `storage: ${failed.error!.message}` };

        return {
          name: f.name,
          drive_file_id: f.id,
          path: `${stem}-web.webp`,
          web: bucket.getPublicUrl(`${stem}-web.webp`).data.publicUrl,
          thumb: bucket.getPublicUrl(`${stem}-thumb.webp`).data.publicUrl,
        };
      } catch (e) {
        return { name: f.name, error: e instanceof Error ? e.message : "failed" };
      }
    })
  );

  return Response.json({ results });
}
