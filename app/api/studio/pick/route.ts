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

// POST /api/studio/pick — the parts list. Free (the parts list is the only free
// AI step) but counted like a BOM run (bomRate: guests 5/day, users 30/day).
// The model picks ids from the library; the server enforces one mcu, power
// parts, the actuator rules (servo count, driver, supply), ≤ 12 kinds of part, then buildWiring() adds the helper parts the rules need
// (resistors, level shifters). The netlist itself is the paid wiring step
// (/api/studio/wiring) and is NOT returned here.
//
// 3d safety mode: for a CLASS project the whole pipeline is handed a library
// with only class-safe parts (lib/schools/safe-parts.ts), so the prompt, the
// validation, the fallback and buildWiring's helper parts can none of them
// reach a mains relay, a bare lithium cell or a 12 V board.

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
    call: studioCall(supabase, project.id),
    spec: body.spec,
    index: libraryIndexForAI(),
    locale: body.locale,
    nameFor: (id, locale) => getPart(id)?.name[locale],
    pinsOf: (id) => getPart(id)?.pins, // Part D: servo pin budget
    cache: pickCache, // W8: the same spec is not asked twice
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
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

  return Response.json({ components, reasons: r.value.reasons, docVersion: saved.version });
}
