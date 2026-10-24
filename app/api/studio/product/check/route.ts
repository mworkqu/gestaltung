import { geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { studioLibrary } from "@/lib/studio/library/remote";
import { ensurePhysical } from "@/lib/studio/product/ai/physical";
import { runVisionCheck } from "@/lib/studio/product/ai/vision";
import { applyPatches } from "@/lib/studio/product/schema";
import { applyCheck, findDesign } from "@/lib/studio/product/store";
import { studioCall, studioRequest } from "@/lib/studio/server/context";
import { loadDocPrivate, updateProductDoc } from "@/lib/studio/server/doc";
import { CHECK_IMAGE_MAX_BYTES, CheckBody, decodePng, json, partsOf, pngBase64, loadErrorStatus } from "@/lib/studio/server/product";

// POST /api/studio/product/check {projectId, designId, images: {front, side, iso} (base64 PNG, 512 px), loop 0..2}
//   → 200 {score 1..10, looksLike, missing, model, changed}
//   → 200 {skipped: "quota" | "no_key", model}   (the model is kept as it is)
// Gemini vision judges "does this look like <product> at a glance, are all its
// functional parts visible?" and proposes JSON patches; we apply only allowed
// paths (applyPatches), re-clamp and re-solve (every part keeps its home).
// Score, loops, looksLike, missing, issues → studio.productPrivate (Engineer view).
// Called by the Studio worker only. Metered in ai_usage (studio / vision).

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, CheckBody, { consent: true, owner: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const images = {
    front: decodePng(body.images.front, CHECK_IMAGE_MAX_BYTES),
    side: decodePng(body.images.side, CHECK_IMAGE_MAX_BYTES),
    iso: decodePng(body.images.iso, CHECK_IMAGE_MAX_BYTES),
  };
  if (!images.front || !images.side || !images.iso) return json({ error: "bad_image" }, 400);

  const cur = await loadDocPrivate(supabase, project.id);
  if (!cur.ok) return json({ error: cur.error }, loadErrorStatus(cur.error));
  if (!cur.doc || !cur.owned.product || !cur.owned.productPrivate) return json({ error: "not_found" }, 404);
  const doc = cur.doc;
  const found = findDesign({ product: cur.owned.product, priv: cur.owned.productPrivate }, body.designId);
  if (!found) return json({ error: "not_found" }, 404);
  const model = found.priv.model;

  if (!geminiConfigured()) return json({ skipped: "no_key", model });

  const { getPart } = await studioLibrary();
  const parts = partsOf(doc.components, getPart);
  const { data: row } = await supabase.from("projects").select("brief").eq("id", project.id).maybeSingle();
  const brief = (row as { brief?: string | null } | null)?.brief;
  const idea = brief?.trim() || `${doc.spec.name}: ${doc.spec.oneLine}`;

  const r = await runVisionCheck({
    call: studioCall(supabase, project.id, ctx.userId),
    idea,
    spec: doc.spec,
    partNames: parts.filter((p) => !p.part.helper).map((p) => p.part.name.en),
    model,
    images: { front: pngBase64(images.front), side: pngBase64(images.side), iso: pngBase64(images.iso) },
    loop: body.loop,
  });
  // Quota, rate limit, an outage or two unreadable answers: keep the solved model.
  if (!r.ok) return json({ skipped: "quota", model });

  const before = ensurePhysical(model, parts, doc.spec).solvedHash;
  const patched = applyPatches(model, r.value.patches);
  const after = ensurePhysical(patched.model, parts, doc.spec);
  const changed = r.value.patches.length > 0 && after.solvedHash !== before;
  const notes = [
    { code: "vision", severity: "info", detail: `loop ${body.loop}: score ${r.value.score}, ${patched.applied} patch(es) applied, ${patched.rejected.length + r.value.dropped} rejected` },
    ...patched.rejected.slice(0, 8).map((x) => ({ code: "patch_rejected", severity: "info", detail: x.reason })),
  ];

  const saved = await updateProductDoc(supabase, ctx.userId, project.id, (s) => {
    const next = applyCheck({ product: s.product, priv: s.priv }, body.designId, {
      score: r.value.score,
      looksLike: r.value.looksLike,
      missing: r.value.missing,
      loop: body.loop,
      patched: after.model,
      patchedHash: after.solvedHash,
      changed,
      notes,
    });
    return { doc: s.doc, ...next };
  });
  if (!saved.saved) console.warn(`[studio/product/check] ${project.id}: not saved (${saved.error})`);

  return json({ score: r.value.score, looksLike: r.value.looksLike, missing: r.value.missing, model: changed ? after.model : model, changed });
}
