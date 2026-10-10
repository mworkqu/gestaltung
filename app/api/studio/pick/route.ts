import { bomRate } from "@/lib/credits/server";
import { studioLibrary } from "@/lib/studio/library/remote";
import { buildWiring } from "@/lib/studio/netlist";
import { emptyStudioDoc, type StudioComponent } from "@/lib/studio/schema";
import { runPick } from "@/lib/studio/ai/pick";
import { updateDoc } from "@/lib/studio/server/doc";
import { callErrorStatus, PickBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/pick — the parts list. Free (the parts list is the only free
// AI step) but counted like a BOM run (bomRate: guests 5/day, users 30/day).
// The model picks ids from the library; the server enforces one mcu, power
// parts, ≤ 12 parts, then buildWiring() adds the helper parts the rules need
// (resistors, level shifters). The netlist itself is the paid wiring step
// (/api/studio/wiring) and is NOT returned here.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, PickBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;
  // Code library + the owner's studio_parts edits (P5-15c), per request.
  const { getPart, libraryIndexForAI } = await studioLibrary();

  const rate = await bomRate(supabase, request);
  if (!rate.allowed) return Response.json({ error: "daily_limit", limit: rate.limit }, { status: 429 });

  const r = await runPick({
    call: studioCall(supabase, project.id),
    spec: body.spec,
    index: libraryIndexForAI(),
    locale: body.locale,
    nameFor: (id, locale) => getPart(id)?.name[locale],
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
  logClamp("pick", project.id, r.clampLog, r.source, r.problems);

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
