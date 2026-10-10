// Loads published products plus "has a supplier offer" for the Fix tile and
// the Fix page (server only, super admin through the cookie client).

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { createClient } from "@/lib/supabase/server";
import { fixIssues, isLiveProduct, type FixIssue, type FixPart } from "@/lib/admin/home-tiles";

type Db = Awaited<ReturnType<typeof createClient>>;

type Row = Omit<FixPart, "hasSupplier"> & { id: string; name: string };

export type FixItem = { part: Row; issues: FixIssue[] };

/** Live products that miss something, name order. Null when the data could not be read. */
export async function loadFixParts(db: Db): Promise<FixItem[] | null> {
  const parts = await fetchAllRows<Row>((from, to) =>
    db
      .from("parts")
      .select("id, sku, name, unit_price, image_url, images, lead_time_class, is_test, is_published, merged_into")
      .eq("is_published", true)
      .is("merged_into", null)
      .order("id")
      .range(from, to)
  );
  if (parts.error) return null;
  const offers = await fetchAllRows<{ part_id: string }>((from, to) =>
    db.from("supplier_offers").select("part_id").order("id").range(from, to)
  );
  if (offers.error) return null;
  const withOffer = new Set(offers.rows.map((o) => o.part_id));

  return parts.rows
    .map((p) => ({ part: p, full: { ...p, hasSupplier: withOffer.has(p.id) } as FixPart }))
    .filter(({ full }) => isLiveProduct(full))
    .map(({ part, full }) => ({ part, issues: fixIssues(full) }))
    .filter((x) => x.issues.length > 0)
    .sort((a, b) => a.part.name.localeCompare(b.part.name));
}
