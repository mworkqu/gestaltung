// The browser reads behind the unified search box
// (components/search/unified-search.tsx), moved out of the component unchanged
// (R11): the client's own inventory (with just the products it references) and
// the live store match.

import { createClient } from "@/lib/supabase/client";
import { PART_PUBLIC_COLUMNS } from "@/lib/store/part-columns";
import type { ClientInventoryItem, Part } from "@/lib/supabase/types";

/** The caller's inventory rows plus the public rows of the products they reference. */
export async function loadOwnedInventory(): Promise<{ inventory: ClientInventoryItem[]; ownedParts: Part[] }> {
  const supabase = createClient();
  // Returns nothing for a guest: no session, no rows, no error.
  const { data: invRows } = await supabase.from("client_inventory_items").select("*");
  const inv = (invRows ?? []) as ClientInventoryItem[];
  const ids = [...new Set(inv.map((r) => r.product_id).filter((x): x is string => !!x))];
  const owned: Part[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("parts").select(PART_PUBLIC_COLUMNS).in("id", ids.slice(i, i + 200));
    owned.push(...((data ?? []) as Part[]));
  }
  return { inventory: inv, ownedParts: owned };
}

/** Published, sold store products matching `q` (already cleaned of filter-syntax characters), 24 at most. */
export async function searchStoreParts(q: string): Promise<Part[]> {
  const like = `%${q}%`;
  const { data } = await createClient()
    .from("parts")
    .select(PART_PUBLIC_COLUMNS)
    .eq("is_published", true)
    .is("merged_into", null)
    .not("lead_time_class", "is", null)
    .or(["name", "name_ar", "sku", "material"].map((c) => `${c}.ilike.${like}`).join(","))
    .order("name")
    .limit(24);
  return (data ?? []) as Part[];
}
