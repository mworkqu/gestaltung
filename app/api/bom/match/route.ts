import { createClient } from "@/lib/supabase/server";
import { activeLines, type ProjectBom } from "@/lib/prototyping/bom";
import type { LineMatch } from "@/lib/prototyping/bom";
import { matchProjectBom } from "@/lib/prototyping/bom-server";
import type { StoreCardPart } from "@/lib/store/catalog";
import { categoriesOf } from "@/lib/store/bought-together";
import { relevantAlsoUseful } from "@/lib/store/also-useful-relevance";
import { getUpsellPool } from "@/lib/store/public-catalog";
import { storeCategoryOf } from "@/lib/store/store-categories";

// Matches a project's bill of materials against the store and the caller's
// own inventory. Server-side so the whole catalogue never ships to the
// browser; every product field in the answer is read from public.parts now.
//
// Each "not stocked" line is written to sourcing_gaps (0023) — the restocking
// list, written by demand. One row per project and function, refreshed on
// every match. They are also recorded as `bom_unmatched` demand signals.
//
// `alsoUseful` (P3-06): three published products from the same store
// categories as the lines' resolved products, none already on the BOM, in
// stock first — from the cached public catalogue (no AI call, no write).

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
  if (!bom?.lines?.length) return Response.json({ matches: [], alsoUseful: [] });

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

  // The same lines as demand signals (0029): a part a customer needs to finish
  // a project. One row per project + line, however often it is matched.
  if (gaps.length) {
    const { error: demandError } = await supabase.rpc("record_bom_demand", {
      p_project: projectId,
      p_lines: gaps.map((l) => ({ id: l.id, label: [l.function, l.spec].filter(Boolean).join(" — "), quantity: l.quantity })),
    });
    if (demandError) console.warn(`[bom] demand not recorded: ${demandError.message}`);
  }

  return Response.json({ matches, alsoUseful: await alsoUsefulFor(matches, bom) });
}

/** "Also useful" under the BOM; any failure is just an empty list. */
async function alsoUsefulFor(matches: LineMatch[], bom: ProjectBom): Promise<StoreCardPart[]> {
  try {
    const products = matches.map((m) => m.product).filter((p): p is NonNullable<LineMatch["product"]> => !!p);
    const categories = categoriesOf(products.map((p) => ({ category: storeCategoryOf(p as { category?: string | null; store_category?: string | null }) })));
    if (!categories.length) return [];
    const onBom = matches.flatMap((m) => [m.product?.sku, ...m.candidates.map((c) => c.sku)]).filter((s): s is string => !!s);
    // Only products that share a function category with the project (P5-04):
    // no camera, soldering iron, servo or stepper for a desk lamp; none at all
    // when fewer than two qualify.
    return relevantAlsoUseful({
      pool: await getUpsellPool(categories),
      excludeSkus: onBom,
      lines: activeLines(bom),
      productNames: products.map((p) => p.name),
    });
  } catch (e) {
    console.warn(`[bom] also useful skipped: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}
