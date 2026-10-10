import { canUse } from "@/lib/credits/server";
import { getPart } from "@/lib/studio/library";
import { templateFor } from "@/lib/studio/enclosure/templates";
import { emptyStudioDoc, DEFAULT_ENCLOSURE, type EnclosureSpec } from "@/lib/studio/schema";
import { runEnclosure, safeBbox } from "@/lib/studio/ai/enclosure";
import { PHASE1_TEMPLATES } from "@/lib/studio/ai/prompts";
import { loadDoc, updateDoc } from "@/lib/studio/server/doc";
import {
  cadRpcError, callErrorStatus, creditDenied, EnclosureBody, rpcMissing, versionFromRegens,
} from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/enclosure — the enclosure look ("Draw it" / "Try another
// look"). The model only returns EnclosureSpec JSON; the browser builds the
// mesh deterministically, so a valid answer IS the delivered result.
//
// Credits reuse the CAD flow exactly (0043): 1 CAD credit covers 3 versions,
// charged when the FIRST result is delivered; failures never charge.
//   canUse("cad") → 401/402 · cad_begin (pending row; parent = the previous
//   studio generation for versions 2–3) · model call · cad_set_code (the JSON
//   in the code column) · cad_deliver right away (spends) · on failure cad_fail.
// Version 4+ = a new credit, decided by canUse/spend_credit as for /api/cad.
// Missing cad RPCs (pre-0043) → 503, fail closed.
// A model failure falls back to a safe default look that is NOT delivered and
// NOT charged (generationId null).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const REQUEST_PREFIX = "studio enclosure:";

export async function POST(request: Request) {
  const ctx = await studioRequest(request, EnclosureBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const access = await canUse(supabase, "cad", project.id);
  const denied = creditDenied(access);
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const current = await loadDoc(supabase, project.id);
  const previous: EnclosureSpec[] = current.ok && current.doc ? current.doc.enclosureVersions ?? (current.doc.enclosure ? [current.doc.enclosure] : []) : [];

  // Versions 2–3 of a paid session hang under the previous studio generation.
  let parentId: string | null = null;
  if (access.cost === "included") {
    const { data } = await supabase
      .from("cad_generations")
      .select("id")
      .eq("project_id", project.id)
      .eq("status", "delivered")
      .like("request", `${REQUEST_PREFIX}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    parentId = (data as { id: string } | null)?.id ?? null;
  }

  const { data: id, error: beginError } = await supabase.rpc("cad_begin", {
    p_project: project.id,
    p_request: `${REQUEST_PREFIX} ${body.spec.name}`.slice(0, 200),
    p_tier: "simple",
    p_parent: parentId,
  });
  if (beginError) {
    if (rpcMissing(beginError)) return Response.json({ error: "needs_migration" }, { status: 503 });
    const e = cadRpcError(beginError.message);
    if (e.status === 500) console.error("[studio/enclosure] cad_begin failed:", beginError.message);
    return Response.json({ error: e.error }, { status: e.status });
  }
  const generationId = id as string;
  const fail = (why: string) => supabase.rpc("cad_fail", { p_id: generationId, p_error: why.slice(0, 500) });

  const bbox = safeBbox(body.bbox);
  const r = await runEnclosure({
    call: studioCall(supabase, project.id),
    spec: body.spec,
    components: body.components.map((c) => {
      const part = getPart(c.partId);
      return { name: c.label || part?.name.en || c.partId, category: part?.category ?? "unknown" };
    }),
    bbox,
    templates: PHASE1_TEMPLATES,
    // Only the last 3 looks matter for "a different one".
    previous: previous.slice(-3),
    // Default look on model failure: the rule-picked template for this product.
    fallback: { ...DEFAULT_ENCLOSURE, template: templateFor(body.spec) },
  });
  if (!r.ok) {
    await fail(r.error);
    return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
  }
  logClamp("enclosure", project.id, r.clampLog, r.source, r.problems);

  if (r.source === "default") {
    // Not the model's work: shown, not delivered, not charged.
    await fail(`default: ${r.problems.join("; ")}`);
    return Response.json({ enclosure: r.value, version: null, versionsLeft: null, generationId: null, fallback: true });
  }

  const { error: codeError } = await supabase.rpc("cad_set_code", {
    p_id: generationId,
    p_scad: JSON.stringify(r.value),
    p_model: r.model ?? "gemini",
  });
  if (codeError) {
    console.error("[studio/enclosure] cad_set_code failed:", codeError.message);
    await fail(`not saved: ${codeError.message}`);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  const { data: delivered, error: deliverError } = await supabase.rpc("cad_deliver", { p_id: generationId });
  if (deliverError) {
    // The row stays pending and nothing is spent (as on the cad paths).
    const e = cadRpcError(deliverError.message);
    if (e.status === 500) console.error("[studio/enclosure] cad_deliver failed:", deliverError.message);
    return Response.json({ error: e.error }, { status: e.status });
  }
  const d = (delivered ?? {}) as { charged?: boolean; regens?: number };
  const { version, versionsLeft } = versionFromRegens(d.regens);

  const saved = await updateDoc(supabase, project.id, (doc) => {
    const base = doc ?? emptyStudioDoc(body.spec);
    const versions = [...(base.enclosureVersions ?? []), r.value].slice(-3);
    return { ...base, enclosure: r.value, enclosureVersions: versions };
  });

  return Response.json({
    enclosure: r.value,
    version,
    versionsLeft,
    generationId,
    charged: Boolean(d.charged),
    docVersion: saved.version,
  });
}
