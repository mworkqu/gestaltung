import { createClient } from "@/lib/supabase/server";
import { buildElectronics } from "@/lib/prototyping/electronics-build";
import { bomRate, canUse, serverWritesReady, spend, spendRefusal, undoUnpaidCircuit } from "@/lib/credits/server";
import { asLocale } from "@/lib/locale";
import { jsonError } from "@/lib/http";

// POST /api/bom/electronics — build the electronics bill of materials for the
// build route the client chose (projects.build_route). Refuses to run before
// a route is chosen: no electronics list is generated until then.
//
// Lists the parts (model), wires them (model, validated), then derives the
// passives, level shifters, consumables and fabrication line (our rules).
//
// Credits (0042): listing the parts is the "bom" step (daily rate limit).
// Wiring them is the "wiring" step: drawn only when the caller may — every
// circuit costs 1 wiring credit (no free first circuit, 0052), charged after a
// circuit was saved. Otherwise the list is rebuilt, the circuit is left as it
// was, and the answer says why (circuit: "skipped", circuitReason).
// AI-05: when the circuit would be drawn but the service key is missing (the
// spend cannot run), the answer is 503 unavailable before any model call
// (admin exempt: never charged). If the spend fails after a circuit was drawn,
// nothing of this build is kept: the project's bom + netlist are put back as
// they were and the answer is the refusal (spendRefusal: 401 / 402 / 404 / 503).

export const dynamic = "force-dynamic";
// Two model calls in a row (list, then circuit), each up to 90 s on a busy
// day, and each with a retry — so this route needs the long limit.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { projectId?: unknown; locale?: unknown; listOnly?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  const locale = asLocale(body?.locale);
  if (!projectId) return new Response(null, { status: 400 });
  // Client view (P5-04): "Find my parts" lists the electronics and draws nothing,
  // so no wiring credit is ever touched; "Draw my wiring" is its own step.
  const listOnly = body?.listOnly === true;

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, brief, spec, bom, netlist, build_route")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return jsonError("not_ready", 409);
  if (!project) return new Response(null, { status: 404 });
  if (!project.build_route) return jsonError("no_route", 409);
  if (!project.brief?.trim()) return jsonError("no_brief", 409);

  const rate = await bomRate(supabase, request);
  if (!rate.allowed) return Response.json({ error: "daily_limit", limit: rate.limit }, { status: 429 });

  const wiring = listOnly ? { allowed: false, reason: "list_only" as const, role: null } : await canUse(supabase, "wiring", project.id);
  // The spend needs the service client (0102): refuse before paying for the model calls.
  if (wiring.allowed && wiring.role !== "admin" && !serverWritesReady()) return jsonError("unavailable", 503);
  const r = await buildElectronics({ supabase, project, locale, relist: true, drawCircuit: wiring.allowed });
  if (!r.ok)
    return Response.json(
      { error: r.error, problems: r.problems },
      { status: r.error === "paused" || r.error === "rate_limited" ? 429 : r.error === "invalid" ? 422 : 502 }
    );
  let charged = false;
  if (r.circuit === "ok") {
    const paid = await spend(supabase, user.id, "wiring", project.id);
    const refused = spendRefusal(paid, wiring.role);
    if (refused) {
      // Not paid: undo buildElectronics' save (the circuit and everything derived from it).
      await undoUnpaidCircuit(supabase, project, "bom/electronics");
      return jsonError(refused.error, refused.status);
    }
    charged = paid.ok && paid.charged;
  }
  return Response.json({
    circuit: r.circuit,
    circuitReason: r.circuit === "skipped" ? wiring.reason : null,
    charged,
    problems: r.problems,
  });
}
