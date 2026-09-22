// Server-only: match a project's bill of materials against the live store and
// the project OWNER's inventory. Shared by /api/bom/match (the page) and the
// diagnostic export, so both report exactly the same matches.

import type { SupabaseClient } from "@supabase/supabase-js";

import { matchLine, type InventoryRow } from "./bom-match";
import type { Candidate, LineMatch, ProjectBom } from "./bom";

export async function matchProjectBom(
  db: SupabaseClient,
  bom: ProjectBom | null | undefined,
  ownerId: string
): Promise<LineMatch[]> {
  if (!bom?.lines?.length) return [];
  const [catRes, invRes] = await Promise.all([
    db.from("parts").select("*").eq("is_published", true).limit(5000),
    db
      .from("client_inventory_items")
      .select("product_id, custom_name, quantity, part:parts(name)")
      .eq("user_id", ownerId),
  ]);
  const catalogue = (catRes.data ?? []) as Candidate[];
  type InvRow = { product_id: string | null; custom_name: string | null; quantity: number; part: { name: string } | null };
  const inv = (invRes.data ?? []) as unknown as InvRow[];
  const inventory: InventoryRow[] = inv.map((r) => ({
    productId: r.product_id,
    customName: r.custom_name,
    quantity: r.quantity,
  }));
  const names = new Map(inv.filter((r) => r.product_id).map((r) => [r.product_id!, r.part?.name ?? ""]));
  return bom.lines.map((l) => matchLine(l, catalogue, inventory, names));
}
