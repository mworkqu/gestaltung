import { applyPreview, findDesign } from "@/lib/studio/product/store";
import { studioRequest } from "@/lib/studio/server/context";
import { loadDocPrivate, updateProductDoc } from "@/lib/studio/server/doc";
import { PREVIEW_MAX_BYTES, PreviewBody, decodePng, json, saveErrorStatus, uploadPreview, loadErrorStatus } from "@/lib/studio/server/product";

// POST /api/studio/product/preview {projectId, designId, png (base64, 3/4 view in scene, ≤ 1024 px)}
//   → 200 {previewPath}
// The final picture of one design (rendered from the real model in the worker,
// never AI-drawn). Stored in the EXISTING private bucket `project-images` at
// studio-previews/<projectId>/<designId>.png (no migration); the design turns
// "ready" and its model becomes the best checked version. The page shows it via
// a signed URL (lib/studio/server/preview-url.ts) — My projects, the quote page
// and the admin lead show the CHOSEN design's picture.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, PreviewBody, { consent: false, owner: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const png = decodePng(body.png, PREVIEW_MAX_BYTES);
  if (!png) return json({ error: "bad_image" }, 400);

  const cur = await loadDocPrivate(supabase, project.id);
  if (!cur.ok) return json({ error: cur.error }, loadErrorStatus(cur.error));
  if (!cur.owned.product || !cur.owned.productPrivate) return json({ error: "not_found" }, 404);
  if (!findDesign({ product: cur.owned.product, priv: cur.owned.productPrivate }, body.designId)) return json({ error: "not_found" }, 404);

  // The project is the caller's (RLS read above); only then the service-role upload.
  const up = await uploadPreview(project.id, body.designId, png);
  if (!up.ok) return json({ error: up.error }, 503);

  const saved = await updateProductDoc(supabase, ctx.userId, project.id, (s) => {
    const next = applyPreview({ product: s.product, priv: s.priv }, body.designId, up.path);
    return { doc: s.doc, ...next };
  });
  if (!saved.saved) return json({ error: saved.error ?? "not_saved" }, saveErrorStatus(saved.error));
  return json({ previewPath: up.path });
}
