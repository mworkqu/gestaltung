import { bomRate } from "@/lib/credits/server";
import { studioLibrary } from "@/lib/studio/library/remote";
import { buildWiring } from "@/lib/studio/netlist";
import { emptyStudioDoc, type StudioComponent } from "@/lib/studio/schema";
import { runPick } from "@/lib/studio/ai/pick";
import { pickCache } from "@/lib/studio/ai/cache";
import { updateDoc } from "@/lib/studio/server/doc";
import { callErrorStatus, PickBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";
import { classGuard } from "@/lib/schools/safe-parts";
import { jsonError, jsonOk } from "@/lib/http";

// POST /api/studio/pick — the parts list. Free (the parts list is the only free
// AI step) but counted like a BOM run (bomRate: guests 5/day, users 30/day).
// The model picks ids from the library; the server enforces one mcu, power
// parts, the actuator rules (servo count, driver, supply), ≤ 12 kinds of part, then buildWiring() adds the helper parts the rules need
// (resistors, level shifters). The netlist itself is the paid wiring step
// (/api/studio/wiring) and is NOT returned here.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, PickBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;
  // Code library + the owner's studio_parts edits (P5-15c), per request.
  const fullLib = await studioLibrary();
  // 3d: a class project only ever sees class-safe parts, server-side.
  const { isClass, lib } = await classGuard(supabase, project.id, fullLib);
  const { getPart, libraryIndexForAI } = lib;

  const rate = await bomRate(supabase, request);
  if (!rate.allowed) return Response.json({ error: "daily_limit", limit: rate.limit }, { status: 429 });

  const r = await runPick({
    call: studioCall(supabase, project.id, ctx.userId),
    spec: body.spec,
    index: libraryIndexForAI(),
    locale: body.locale,
    nameFor: (id, locale) => getPart(id)?.name[locale],
    pinsOf: (id) => getPart(id)?.pins, // Part D: servo pin budget
    // F-046: our code, never the model, prefers a part we can hand over. A linked store SKU is
    // what "we have it" means here (docs/STUDIO_SKU_LINKS.md); parts without one are sourced.
    stockOf: (id) => (getPart(id)?.storeSkus.length ?? 0) > 0,
    // Card items the model's index leaves out (the LED is a helper part): added by id.
    lookup: (id) => {
      const p = getPart(id);
      return p ? { id: p.id, category: p.category, tags: p.tags } : undefined;
    },
    cache: pickCache, // W8: the same spec is not asked twice
  });
  if (!r.ok) return jsonError(r.error, callErrorStatus(r.error));
  logClamp("pick", project.id, r.clampLog, r.source, r.problems);
  if (isClass) console.info(`[studio/pick] ${project.id}: class project — ${lib.parts.length} safe parts offered`);

  // Helper parts from the rules (auto: true). A rules failure keeps the picked list.
  let components: StudioComponent[] = r.value.components;
  try {
    components = buildWiring(r.value.components, body.spec, getPart, body.locale).components;
  } catch (e) {
    console.error("[studio/pick] buildWiring failed:", e instanceof Error ? e.message : e);
  }

  const saved = await updateDoc(supabase, project.id, (doc) => {
    const base = doc ?? emptyStudioDoc(body.spec);
    // New parts invalidate the old circuit and layout.
    return { ...base, spec: body.spec, components, netlist: { nets: [] }, checks: [], layout: [], mech: [] };
  });

  return jsonOk({ components, reasons: r.value.reasons, docVersion: saved.version });
}
