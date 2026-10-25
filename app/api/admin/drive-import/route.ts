import { getSessionContext } from "@/lib/auth/get-session";
import { readCapped } from "@/lib/net/safe-fetch";
import { isRasterContentType, storeImage } from "@/lib/store/store-image";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdminSession } from "@/lib/auth/guards";
import { emptyStatus, jsonOk } from "@/lib/http";

// Copies Google Drive images (picked in the admin) into Supabase Storage
// (Task 17b). Never hotlinks Drive. For each file: download with the owner's
// short-lived drive.file token, make a web version (≤ 1600 px WebP) and a
// thumbnail (400 px WebP), upload both to the public `product-images` bucket
// (0029), and return their URLs with the Drive file id for traceability.
// super_admin only (checked here and by the bucket policy).
// Raster images only and a streamed byte cap (WEB-05 / API-08): storeImage
// checks magic bytes and sharp's format before processing; SVG is refused.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{10,200}$/;

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!isSuperAdminSession(session)) return emptyStatus(403);

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

  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return { name: f.name, error: `drive_${res.status}` };
        if (!isRasterContentType(res.headers.get("content-type"))) {
          await res.body?.cancel().catch(() => {});
          return { name: f.name, error: "not_image" };
        }
        const bytes = await readCapped(res, MAX_BYTES);
        if (!bytes) return { name: f.name, error: "too_large" };

        const img = await storeImage(supabase, Buffer.from(bytes), `drive/${f.id}/${Date.now()}`, f.id);
        return { name: f.name, ...img };
      } catch (e) {
        return { name: f.name, error: e instanceof Error ? e.message : "failed" };
      }
    })
  );

  return jsonOk({ results });
}
