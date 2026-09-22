import { createClient } from "@/lib/supabase/server";
import type { ProjectBom } from "@/lib/prototyping/bom";
import { matchProjectBom } from "@/lib/prototyping/bom-server";

// Matches a project's bill of materials against the store and the caller's
// own inventory. Server-side so the whole catalogue never ships to the
// browser; every product field in the answer is read from public.parts now.
//
// Each "not stocked" line is written to sourcing_gaps (0023) — the restocking
// list, written by demand. One row per project and function, refreshed on
// every match.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { projectId?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  if (!projectId) return new Response(null, { status: 400 });

  // RLS: only the owner (or super_admin) gets the row.
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, user_id, bom")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return Response.json({ error: "not_ready" }, { status: 409 });
  if (!project) return new Response(null, { status: 404 });

  const bom = (project as { bom?: ProjectBom | null }).bom;
  if (!bom?.lines?.length) return Response.json({ matches: [] });

  const matches = await matchProjectBom(supabase, bom, project.user_id as string);

  const notStocked = new Set(matches.filter((m) => m.status === "not_stocked").map((m) => m.lineId));
  const gaps = bom.lines.filter((l) => notStocked.has(l.id));
  const logged = await Promise.all(
    gaps.map((l) =>
      supabase.rpc("log_sourcing_gap", {
        p_project: projectId,
        p_function: l.function,
        p_spec: l.spec,
        p_kind: l.kind,
        p_quantity: l.quantity,
      })
    )
  );
  const failed = logged.find((r) => r.error);
  if (failed) console.warn(`[bom] sourcing gap not logged: ${failed.error!.message}`);

  return Response.json({ matches });
}
