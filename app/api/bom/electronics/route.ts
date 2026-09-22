import { createClient } from "@/lib/supabase/server";
import { buildElectronics } from "@/lib/prototyping/electronics-build";

// POST /api/bom/electronics — build the electronics bill of materials for the
// build route the client chose (projects.build_route). Refuses to run before
// a route is chosen: no electronics list is generated until then.
//
// Lists the parts (model), wires them (model, validated), then derives the
// passives, level shifters, consumables and fabrication line (our rules).

export const dynamic = "force-dynamic";
// Two model calls in a row (list, then circuit), each up to ~55 s on a busy day.
export const maxDuration = 180;

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
  if (!project.build_route) return Response.json({ error: "no_route" }, { status: 409 });
  if (!project.brief?.trim()) return Response.json({ error: "no_brief" }, { status: 409 });

  const r = await buildElectronics({ supabase, project, locale, relist: true });
  if (!r.ok)
    return Response.json(
      { error: r.error, problems: r.problems },
      { status: r.error === "paused" || r.error === "rate_limited" ? 429 : r.error === "invalid" ? 422 : 502 }
    );
  return Response.json({ circuit: r.circuit, problems: r.problems });
}
