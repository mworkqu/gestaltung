import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { DOC_MAX_BYTES, loadDoc, saveDoc } from "@/lib/studio/server/doc";
import { DocPutBody } from "@/lib/studio/server/http";

// GET  /api/studio/doc?projectId= → {doc, version} (doc null when none / unreadable)
// PUT  /api/studio/doc {projectId, doc, version} → 200 {version}
//      | 409 {error:"conflict", doc, version} | 409 {error:"run_0068"}
//      | 400 invalid | 413 too_large
// projects.studio + studio_version (0068), written through RLS with
// optimistic concurrency. Guest sessions count as users.

export const dynamic = "force-dynamic";

const Id = z.string().uuid();

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });
  const projectId = Id.safeParse(new URL(request.url).searchParams.get("projectId"));
  if (!projectId.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const r = await loadDoc(supabase, projectId.data);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === "not_found" ? 404 : 500 });
  if (!r.available) return Response.json({ doc: null, version: 0, error: "run_0068" });
  return Response.json({ doc: r.doc, version: r.version });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });

  const text = await request.text().catch(() => "");
  // Envelope allowance on top of the doc cap.
  if (Buffer.byteLength(text, "utf8") > DOC_MAX_BYTES + 4096) return Response.json({ error: "too_large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = DocPutBody.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const r = await saveDoc(supabase, parsed.data.projectId, parsed.data.doc, parsed.data.version);
  if (r.ok) return Response.json({ version: r.version });
  if (r.error === "conflict") return Response.json({ error: "conflict", doc: r.doc, version: r.version }, { status: 409 });
  if (r.error === "run_0068") return Response.json({ error: "run_0068" }, { status: 409 });
  if (r.error === "too_large") return Response.json({ error: "too_large" }, { status: 413 });
  if (r.error === "invalid") return Response.json({ error: "invalid" }, { status: 400 });
  if (r.error === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ error: "failed" }, { status: 500 });
}
