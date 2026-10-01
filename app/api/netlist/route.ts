import { createClient } from "@/lib/supabase/server";
import { buildElectronics } from "@/lib/prototyping/electronics-build";
import { canUse, spend } from "@/lib/credits/server";

// POST /api/netlist — redraw the circuit for the electronics lines already in
// the bill of materials, then re-derive the rule lines (passives, level
// shifters, consumables) from the new circuit.
//
// The model returns structure — components, pins, nets, rails — never a
// picture. Its answer must pass zod (shape) AND crossValidate() (every bomId
// is a BOM line, every connection names a real component and pin). A failure
// is sent back once with the problems; a second failure returns them and
// nothing is saved or drawn (lib/prototyping/ai-call.ts).
//
// Credits (0042): drawing the circuit is the "wiring" step. Anonymous callers
// are sent to sign in; a user's first circuit per project is free, each later
// one costs 1 wiring credit — charged only after a circuit was saved.
//
// Test hook (never active in production): NETLIST_TEST_BREAK=1 points one
// connection at a component that does not exist, on every attempt.

export const dynamic = "force-dynamic";
// One model call with one possible retry, up to 90 s each.
export const maxDuration = 240;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { projectId?: unknown; locale?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  const locale = body?.locale === "ar" ? "ar" : "en";
  if (!projectId) return new Response(null, { status: 400 });

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, brief, spec, bom, netlist, build_route")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return Response.json({ error: "not_ready" }, { status: 409 });
  if (!project) return new Response(null, { status: 404 });

  const access = await canUse(supabase, "wiring", project.id);
  if (!access.allowed)
    return Response.json({ error: access.reason ?? "no_credits" }, { status: access.reason === "sign_in" ? 401 : 402 });

  const r = await buildElectronics({ supabase, project, locale, relist: false });
  if (!r.ok)
    return Response.json(
      { error: r.error, problems: r.problems },
      { status: r.error === "no_electronics" ? 422 : r.error === "paused" || r.error === "rate_limited" ? 429 : 502 }
    );
  if (r.circuit === "failed") return Response.json({ error: "invalid", problems: r.problems.slice(0, 6) }, { status: 422 });
  const paid = await spend(supabase, "wiring", project.id);
  return Response.json({ netlist: r.netlist, charged: paid.ok ? paid.charged : false, cost: access.cost });
}
