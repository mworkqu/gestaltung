// Server-only: match a project's bill of materials against the live store and
// the project OWNER's inventory. Shared by /api/bom/match (the page) and the
// diagnostic export, so both report exactly the same matches.
//
// Bought lines report "fulfilled" and fabrication lines "fabrication" — those
// are never matched against the store. Removed (dismissed) lines are skipped.

import type { SupabaseClient } from "@supabase/supabase-js";

import { matchLine, type InventoryRow } from "./bom-match";
import { groupOf, type Candidate, type LineMatch, type ProjectBom } from "./bom";
import type { Attributes } from "@/lib/store/attributes";

export async function matchProjectBom(
  db: SupabaseClient,
  bom: ProjectBom | null | undefined,
  ownerId: string
): Promise<LineMatch[]> {
  if (!bom?.lines?.length) return [];
  const dismissed = new Set(bom.dismissed ?? []);
  const [catRes, invRes] = await Promise.all([
    db.from("parts").select("*").eq("is_published", true).limit(5000),
    db
      .from("client_inventory_items")
      .select("*, part:parts(name)")
      .eq("user_id", ownerId),
  ]);
  const catalogue = (catRes.data ?? []) as Candidate[];
  type InvRow = {
    product_id: string | null;
    custom_name: string | null;
    quantity: number;
    attributes?: Attributes | null;
    part: { name: string } | null;
  };
  const inv = (invRes.data ?? []) as unknown as InvRow[];
  const inventory: InventoryRow[] = inv.map((r) => ({
    productId: r.product_id,
    customName: r.custom_name,
    quantity: r.quantity,
    attributes: r.attributes ?? null,
  }));
  const names = new Map(inv.filter((r) => r.product_id).map((r) => [r.product_id!, r.part?.name ?? ""]));

  return bom.lines
    .filter((l) => !dismissed.has(l.id))
    .map((l): LineMatch => {
      if (l.fulfilled) return { lineId: l.id, status: "fulfilled", candidates: [], product: null, have: null };
      if (groupOf(l) === "fabrication")
        return { lineId: l.id, status: "fabrication", candidates: [], product: null, have: null };
      return matchLine(l, catalogue, inventory, names);
    });
}
