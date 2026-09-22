import { createClient } from "@/lib/supabase/server";
import { matchLine, type InventoryRow } from "@/lib/prototyping/bom-match";
import type { Candidate, LineMatch, ProjectBom } from "@/lib/prototyping/bom";

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
    .select("id, bom")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return Response.json({ error: "not_ready" }, { status: 409 });
  if (!project) return new Response(null, { status: 404 });

  const bom = (project as { bom?: ProjectBom | null }).bom;
  if (!bom?.lines?.length) return Response.json({ matches: [] });

  const [catRes, invRes] = await Promise.all([
    supabase.from("parts").select("*").eq("is_published", true).limit(5000),
    supabase
      .from("client_inventory_items")
      .select("product_id, custom_name, quantity, part:parts(name)")
      .eq("user_id", user.id),
  ]);
  const catalogue = (catRes.data ?? []) as Candidate[];
  type InvRow = { product_id: string | null; custom_name: string | null; quantity: number; part: { name: string } | null };
  const inv = (invRes.data ?? []) as unknown as InvRow[];
  const inventory: InventoryRow[] = inv.map((r) => ({
    productId: r.product_id,
    customName: r.custom_name,
    quantity: r.quantity,
  }));
  const inventoryNames = new Map(inv.filter((r) => r.product_id).map((r) => [r.product_id!, r.part?.name ?? ""]));

  const matches: LineMatch[] = bom.lines.map((l) => matchLine(l, catalogue, inventory, inventoryNames));

  const gaps = bom.lines.filter((l, i) => matches[i].status === "not_stocked");
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
  if (failed) console.warn(`[bom] sourcing gap not logged (run migration 0023?): ${failed.error!.message}`);

  return Response.json({ matches });
}
