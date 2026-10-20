import { productDesignCache } from "@/lib/studio/ai/cache";
import { studioLibrary } from "@/lib/studio/library/remote";
import { pickArchetypes, runProductDesign } from "@/lib/studio/product/ai/design";
import { addDesigns, applyRegen } from "@/lib/studio/product/store";
import { studioCall, logClamp, studioRequest } from "@/lib/studio/server/context";
import { loadDocPrivate, updateProductDoc } from "@/lib/studio/server/doc";
import {
  DesignBody, guestDesignLimit, json, newDesignId, partsOf, productSpecHash, saveErrorStatus, serviceLimitStore,
} from "@/lib/studio/server/product";
import { ideaCharge, ideaStatus, tokenInfo } from "@/lib/studio/server/tokens";
import { regenCost, tierOf } from "@/lib/studio/tiers";
import { geminiConfigured } from "@/lib/prototyping/providers/gemini-client";

// POST /api/studio/product/design {projectId, count 1..3, exclude?: Archetype[]}
//   → 200 {designs: [{id, model, why: {en, ar}, archetype}]}
//   → 429 {error: "guest_limit"}  (guests: 3 builds per Qatar day per session / IP)
// Regeneration (feedback?: string ≤ 400 chars, or a non-empty exclude): the FIRST one per
// project is free, each later one costs IDEATION.regenCost × build tier ideation tokens.
//   → 402 {error: "no_tokens", need, tokens}  before the model is called when the balance is short.
// The feedback steers a NEW set of three (it is part of the design cache key); the old
// designs stay in the doc untouched. The count lives in studio.product.regens (server-owned).
// Called by the Studio WORKER (P5-16 contract), never rendered on the page.
// Spec + parts are read SERVER-side from projects.studio. Designs are stored:
// page-safe metadata in studio.product, models in studio.productPrivate.
// AI = Gemini JSON mode (lib/studio/product/ai/design.ts); any failure (no key,
// quota, invalid twice) → the archetype defaults, never an empty answer.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, DesignBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project, userId, isAnonymous } = ctx;

  const cur = await loadDocPrivate(supabase, project.id);
  if (!cur.ok) return json({ error: cur.error }, cur.error === "not_found" ? 404 : 500);
  if (!cur.available) return json({ error: "run_0068" }, 409);
  if (!cur.doc || cur.doc.components.length === 0) return json({ error: "no_parts" }, 409);
  const doc = cur.doc;

  if (isAnonymous) {
    const limit = await guestDesignLimit(request, userId, serviceLimitStore());
    if (!limit.allowed) return json({ error: "guest_limit" }, 429);
  }

  // Regeneration pricing: the first is free, then tokens (× tier). Checked before any model call.
  const feedback = body.feedback || null;
  const isRegen = Boolean(feedback) || body.exclude.length > 0;
  const regensSoFar = cur.owned.product?.regens ?? 0;
  const cost = isRegen ? regenCost(regensSoFar, doc.spec) : 0;
  const status = cost > 0 ? await ideaStatus(supabase, project.id) : null;
  if (status && status.role !== "admin" && cost > status.balance) {
    return json({ error: "no_tokens", need: cost, tokens: tokenInfo({ status, spec: doc.spec }) }, 402);
  }

  const { getPart } = await studioLibrary();
  const parts = partsOf(doc.components, getPart);
  const archetypes = pickArchetypes(doc.spec, body.count, body.exclude);
  if (!archetypes.length) return json({ designs: [] });

  const { data: row } = await supabase.from("projects").select("brief").eq("id", project.id).maybeSingle();
  const brief = (row as { brief?: string | null } | null)?.brief ?? null;

  const run = await runProductDesign({
    call: geminiConfigured() ? studioCall(supabase, project.id) : null,
    spec: doc.spec,
    parts,
    archetypes,
    brief,
    feedback,
    attempt: isRegen ? regensSoFar + 1 : 0,
    cache: productDesignCache,
  });
  logClamp("product", project.id, run.clampLog, run.source, run.problems);

  const designs = run.designs.map((d) => ({ ...d, id: newDesignId() }));
  const specHash = productSpecHash(doc.spec, doc.components);
  // A regeneration the model answered counts (and is charged); a fallback to the defaults is neither.
  const counted = isRegen && run.source === "model";
  const saved = await updateProductDoc(supabase, project.id, (s) => {
    const added = addDesigns({ product: s.product, priv: s.priv }, designs, specHash);
    return { doc: s.doc, ...(counted ? applyRegen(added) : added) };
  });
  if (!saved.saved) return json({ error: saved.error ?? "not_saved" }, saveErrorStatus(saved.error));

  const charge = counted && cost > 0 ? await ideaCharge(supabase, project.id, cost, tierOf(doc.spec).id, false) : null;

  return json({
    designs: designs.map((d) => ({ id: d.id, model: d.model, why: d.why, archetype: d.archetype })),
    ...(isRegen ? { regens: saved.state?.product.regens ?? regensSoFar, charged: charge?.ok ? charge.charged : 0 } : {}),
  });
}
