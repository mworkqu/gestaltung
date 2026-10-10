import { bomRate } from "@/lib/credits/server";
import { getPart } from "@/lib/studio/library";
import { runMech } from "@/lib/studio/ai/mech";
import { layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { loadDoc, updateDoc } from "@/lib/studio/server/doc";
import { callErrorStatus, MechBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/mech — printable parts that hold the components inside the
// enclosure (Phase 2). Free (part of the enclosure deliverable) but counted
// like a BOM run (bomRate). Reads the saved doc (parts, layout, enclosure);
// the model returns templates + numbers only, clamped to MECH_PARAMS; two
// failures → the deterministic list.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, MechBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const current = await loadDoc(supabase, project.id);
  if (!current.ok) return Response.json({ error: current.error }, { status: current.error === "not_found" ? 404 : 500 });
  if (!current.available) return Response.json({ error: "run_0068" }, { status: 409 });
  const doc = current.doc;
  if (!doc || !doc.components.length || !doc.enclosure) return Response.json({ error: "no_enclosure" }, { status: 422 });

  const rate = await bomRate(supabase, request);
  if (!rate.allowed) return Response.json({ error: "daily_limit", limit: rate.limit }, { status: 429 });

  const outer = body.dims ?? (() => {
    const b = layoutBounds(doc.components, doc.layout, getPart);
    const pad = 2 * (doc.enclosure.wall + doc.enclosure.clearance);
    return b ? { w: b.w + pad, d: b.d + pad, h: b.h + pad } : { w: 60, d: 40, h: 25 };
  })();
  const summary = mechSummary({ components: doc.components, layout: doc.layout, getPart, enclosure: outer, template: doc.enclosure.template });

  const r = await runMech({ call: studioCall(supabase, project.id), summary });
  if (!r.ok) return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
  logClamp("mech", project.id, r.clampLog, r.source, r.problems);

  const saved = await updateDoc(supabase, project.id, (d) => (d ? { ...d, mech: r.value } : null));
  return Response.json({ mech: r.value, docVersion: saved.version });
}
