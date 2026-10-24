import { z } from "zod";

import { DOC_MAX_BYTES, loadDoc, saveDoc } from "@/lib/studio/server/doc";
import { DocPutBody } from "@/lib/studio/server/http";
import { studioLibrary } from "@/lib/studio/library/remote";
import { classDocRefusal } from "@/lib/schools/safe-parts";
import { isClassProject } from "@/lib/schools/server";
import { requireUser } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";

// GET  /api/studio/doc?projectId= → {doc, version} (doc null when none / unreadable)
// PUT  /api/studio/doc {projectId, doc, version} → 200 {version}
//      | 409 {error:"conflict", doc, version} | 409 {error:"run_0068"}
//      | 400 invalid | 413 too_large
// projects.studio + studio_version (0068), written through RLS with
// optimistic concurrency. Guest sessions count as users.
//
// 3d safety mode: the Parts step can add a part BY HAND, which never goes near
// /api/studio/pick, so a class project's save is refused (422 unsafe_part) when
// the document names a part a class may not use.

export const dynamic = "force-dynamic";

const Id = z.string().uuid();

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const projectId = Id.safeParse(new URL(request.url).searchParams.get("projectId"));
  if (!projectId.success) return jsonError("bad_request", 400);

  const r = await loadDoc(supabase, projectId.data);
  if (!r.ok) return jsonError(r.error, r.error === "not_found" ? 404 : 500);
  if (!r.available) return jsonOk({ doc: null, version: 0, error: "run_0068" });
  return jsonOk({ doc: r.doc, version: r.version });
}

export async function PUT(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const text = await request.text().catch(() => "");
  // Envelope allowance on top of the doc cap.
  if (Buffer.byteLength(text, "utf8") > DOC_MAX_BYTES + 4096) return jsonError("too_large", 413);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return jsonError("bad_request", 400);
  }
  const parsed = DocPutBody.safeParse(json);
  if (!parsed.success) return jsonError("invalid", 400);

  // 3d: refuse an unsafe part in a class project's document. Only asked when
  // the document actually names parts, so an empty autosave costs nothing.
  if (parsed.data.doc.components.length > 0 && (await isClassProject(supabase, parsed.data.projectId))) {
    const refusal = classDocRefusal(parsed.data.doc.components, await studioLibrary());
    if (refusal) {
      console.warn(`[studio/doc] ${parsed.data.projectId}: class project refused ${refusal.parts.join(", ")}`);
      return Response.json(refusal, { status: 422 });
    }
  }

  const r = await saveDoc(supabase, parsed.data.projectId, parsed.data.doc, parsed.data.version);
  if (r.ok) return jsonOk({ version: r.version });
  if (r.error === "conflict") return Response.json({ error: "conflict", doc: r.doc, version: r.version }, { status: 409 });
  if (r.error === "run_0068") return jsonError("run_0068", 409);
  if (r.error === "too_large") return jsonError("too_large", 413);
  if (r.error === "invalid") return jsonError("invalid", 400);
  if (r.error === "not_found") return jsonError("not_found", 404);
  return jsonError("failed", 500);
}
