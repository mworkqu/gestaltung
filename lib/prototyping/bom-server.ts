// Server-only: match a project's bill of materials against the live store and
// the project OWNER's inventory. Shared by /api/bom/match (the page) and the
// diagnostic export, so both report exactly the same matches.
//
// Bought lines report "fulfilled" and fabrication lines "fabrication" — those
// are never matched against the store. A bought line still carries the store
// product it was bought as (by the order's product id, else its sku) so its
// unit price and the wiring view can name it; it is never re-bought or totalled
// (bom.ts buyable/bomCost skip fulfilled lines). Removed (dismissed) lines are
// skipped.

import type { DbClient } from "@/lib/supabase/db";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import { matchLine, type InventoryRow } from "./bom-match";
import { groupOf, type Candidate, type LineMatch, type ProjectBom, type ProjectLine, type ScoredCandidate } from "./bom";
import { readAttributes } from "@/lib/store/attributes";
import { PART_PUBLIC_COLUMNS } from "@/lib/store/part-columns";

export async function matchProjectBom(
  db: DbClient,
  bom: ProjectBom | null | undefined,
  ownerId: string
): Promise<LineMatch[]> {
  if (!bom?.lines?.length) return [];
  const dismissed = new Set(bom.dismissed ?? []);
  const [catRes, invRes] = await Promise.all([
    // Every published product, paged (a response stops at 1,000 rows).
    fetchAllRows<Candidate>((from, to) => db.from("parts").select(PART_PUBLIC_COLUMNS).eq("is_published", true).order("id").range(from, to)),
    db
      .from("client_inventory_items")
      .select("*, part:parts(name)")
      .eq("user_id", ownerId),
  ]);
  const catalogue = catRes.rows;
  const inv = invRes.data ?? [];
  const inventory: InventoryRow[] = inv.map((r) => ({
    productId: r.product_id,
    customName: r.custom_name,
    quantity: r.quantity,
    attributes: readAttributes(r.attributes),
  }));
  const byId = new Map(catalogue.map((p) => [p.id, p]));
  const bySku = new Map(catalogue.map((p) => [p.sku, p]));
  const boughtAs = (l: ProjectLine): ScoredCandidate | null => {
    const f = l.fulfilled;
    const p = (f?.productId ? byId.get(f.productId) : undefined) ?? (f?.sku ? bySku.get(f.sku) : undefined);
    return p ? { ...p, strength: "strong", why: ["ordered"] } : null;
  };
  const names = new Map(inv.filter((r) => r.product_id).map((r) => [r.product_id!, r.part?.name ?? ""]));

  return bom.lines
    .filter((l) => !dismissed.has(l.id))
    .map((l): LineMatch => {
      if (l.fulfilled) return { lineId: l.id, status: "fulfilled", candidates: [], product: boughtAs(l), have: null };
      if (groupOf(l) === "fabrication")
        return { lineId: l.id, status: "fabrication", candidates: [], product: null, have: null };
      return matchLine(l, catalogue, inventory, names);
    });
}
