import { studioCadTier } from "@/lib/credits/cad-cost";
import { canUse, serverWritesReady, setCadCode } from "@/lib/credits/server";
import { finalModel } from "@/lib/studio/product/private";
import { applyUnlock, findDesign } from "@/lib/studio/product/store";
import { studioRequest } from "@/lib/studio/server/context";
import { loadDocPrivate, updateProductDoc } from "@/lib/studio/server/doc";
import { cadRpcError, creditDenied, rpcMissing, versionFromRegens } from "@/lib/studio/server/http";
import { DesignRefBody, json, saveErrorStatus, loadErrorStatus } from "@/lib/studio/server/product";

// POST /api/studio/product/unlock {projectId, designId} → 200 {unlockedId, model}
//   → 402 {error: "no_credits"} · 403 {error: "sign_in"} (guests sign in first, W1 return path)
// "Create my CAD": the SAME credit mechanism as the Studio enclosure route
// (0043 cad flow): canUse("cad") → cad_begin (parent = the last delivered studio
// generation while the session has versions left) → cad_set_code_for (the model
// JSON, written by the server through the service client with the verified user
// id — 0102 / audit G-C1; no service key → 503 {error: "service_unavailable"},
// the same answer this route gives when the private models cannot be read)
// → cad_deliver (spends; 1 CAD credit = the chosen design + up to 2 changes;
// admin free). The design that is already unlocked answers again without a charge.

export const dynamic = "force-dynamic";

const REQUEST_PREFIX = "studio product:";

export async function POST(request: Request) {
  const ctx = await studioRequest(request, DesignRefBody, { consent: false, owner: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const cur = await loadDocPrivate(supabase, project.id);
  if (!cur.ok) return json({ error: cur.error }, loadErrorStatus(cur.error));
  if (!cur.owned.product || !cur.owned.productPrivate) return json({ error: "not_found" }, 404);
  const found = findDesign({ product: cur.owned.product, priv: cur.owned.productPrivate }, body.designId);
  if (!found) return json({ error: "not_found" }, 404);
  const model = finalModel(found.priv);

  if (cur.owned.product.unlockedId === body.designId) return json({ unlockedId: body.designId, model, charged: false });

  const access = await canUse(supabase, "cad", project.id);
  const denied = creditDenied(access);
  if (denied) {
    // Contract: 402 no_credits, 403 sign_in (a guest session is not anonymous to us, so not 401).
    const status = denied.error === "sign_in" ? 403 : denied.status;
    return json({ error: denied.error }, status);
  }
  // No service key → the code could not be stored (and the doc not saved): refuse before cad_begin.
  if (!serverWritesReady()) return json({ error: "service_unavailable" }, 503);

  // A change within a paid session hangs under the previous studio generation.
  let parentId: string | null = null;
  if (access.cost === "included") {
    const { data } = await supabase
      .from("cad_generations")
      .select("id")
      .eq("project_id", project.id)
      .eq("status", "delivered")
      .like("request", "studio %")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    parentId = (data as { id: string } | null)?.id ?? null;
  }

  const { data: id, error: beginError } = await supabase.rpc("cad_begin", {
    p_project: project.id,
    p_request: `${REQUEST_PREFIX} ${cur.doc?.spec.name ?? "product"} (${found.pub.archetype})`.slice(0, 200),
    p_tier: studioCadTier(cur.doc?.components.length ?? 0),
    p_parent: parentId,
  });
  if (beginError) {
    if (rpcMissing(beginError)) return json({ error: "needs_migration" }, 503);
    const e = cadRpcError(beginError.message);
    if (e.status === 500) console.error("[studio/product/unlock] cad_begin failed:", beginError.message);
    return json({ error: e.error }, e.error === "sign_in" ? 403 : e.status);
  }
  const generationId = id as string;
  const fail = (why: string) => supabase.rpc("cad_fail", { p_id: generationId, p_error: why.slice(0, 500) });

  const stored = await setCadCode(supabase, ctx.userId, generationId, JSON.stringify(model), `product:${found.priv.source}`);
  if (!stored.ok) {
    console.error("[studio/product/unlock] cad_set_code_for failed:", stored.message);
    await fail(`not saved: ${stored.message}`);
    return stored.error === "unavailable" ? json({ error: "service_unavailable" }, 503) : json({ error: "failed" }, 500);
  }
  const { data: delivered, error: deliverError } = await supabase.rpc("cad_deliver", { p_id: generationId });
  if (deliverError) {
    const e = cadRpcError(deliverError.message);
    if (e.status === 500) console.error("[studio/product/unlock] cad_deliver failed:", deliverError.message);
    return json({ error: e.error }, e.error === "sign_in" ? 403 : e.status);
  }
  const d = (delivered ?? {}) as { charged?: boolean; regens?: number };

  const saved = await updateProductDoc(supabase, ctx.userId, project.id, (s) => ({ doc: s.doc, ...applyUnlock({ product: s.product, priv: s.priv }, body.designId) }));
  if (!saved.saved) {
    // Paid but not recorded: log loudly; the next unlock of this design is "included" (no second charge).
    console.error(`[studio/product/unlock] ${project.id}/${body.designId}: delivered ${generationId} but not saved (${saved.error})`);
    return json({ error: saved.error ?? "not_saved" }, saveErrorStatus(saved.error));
  }
  const { versionsLeft } = versionFromRegens(d.regens);
  return json({ unlockedId: body.designId, model, charged: Boolean(d.charged), changesLeft: versionsLeft });
}
