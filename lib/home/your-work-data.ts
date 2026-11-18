// The reads behind the signed-in "Your work" strip on the home (P3-05 / WF-33).
// Moved out of components/home/your-work-strip.tsx unchanged (R11): the queries
// live next to the selection logic in ./your-work, the component keeps state and
// markup. Browser client, loaded lazily; RLS limits every read to the caller's
// own rows and the filters only keep an admin's view to their own work.

import { loadSupabase } from "@/lib/supabase/lazy";
import { PROJECT_HREF_COLUMNS } from "@/lib/projects/href";
import {
  YOUR_WORK_PROJECTS,
  partsToBuy,
  pickActiveProjects,
  pickLastDelivered,
  REORDER_PART_COLUMNS,
  type PartsToBuy,
  type ReorderPart,
  type WorkOrderRow,
  type WorkProjectRow,
} from "@/lib/home/your-work";

export type YourWorkData = {
  projects: WorkProjectRow[];
  toBuy: PartsToBuy;
  lastOrder: WorkOrderRow | null;
  lastDelivered: WorkOrderRow | null;
};

export async function loadYourWork(userId: string): Promise<YourWorkData | null> {
  const supabase = await loadSupabase();

  const listProjects = async (): Promise<WorkProjectRow[]> => {
    // `status` arrives with migration 0042; before it every project is active.
    const base = () =>
      supabase.from("projects").select("id, name, updated_at").eq("user_id", userId).order("updated_at", { ascending: false });
    const withStatus = await supabase
      .from("projects")
      .select(`id, name, status, updated_at, ${PROJECT_HREF_COLUMNS}`)
      .eq("user_id", userId)
      .or("status.is.null,status.neq.archived")
      .order("updated_at", { ascending: false })
      .limit(YOUR_WORK_PROJECTS);
    const res = withStatus.error ? await base().limit(YOUR_WORK_PROJECTS) : withStatus;
    if (res.error) return [];
    return pickActiveProjects(res.data ?? []);
  };

  const readOrders = async (delivered: boolean): Promise<WorkOrderRow | null> => {
    let q = supabase.from("part_orders").select("id, status, created_at").eq("profile_id", userId);
    if (delivered) q = q.eq("status", "delivered");
    const res = await q.order("created_at", { ascending: false }).limit(1);
    if (res.error) return null;
    return (res.data ?? [])[0] ?? null;
  };

  const [projects, lastOrder, delivered] = await Promise.all([listProjects(), readOrders(false), readOrders(true)]);
  if (projects.length === 0 && !lastOrder) return null;

  // The bill of materials of the three projects shown, in one read. The count is
  // taken from the stored lines only (no store matching, no AI), so a failed
  // read simply means "unknown".
  let toBuy: PartsToBuy = { kind: "unknown" };
  if (projects.length > 0) {
    const res = await supabase
      .from("projects")
      .select("id, bom")
      .in(
        "id",
        projects.map((p) => p.id)
      );
    if (!res.error) toBuy = partsToBuy((res.data ?? []) as Pick<WorkProjectRow, "bom">[]);
  }

  return {
    projects,
    toBuy,
    lastOrder,
    lastDelivered: pickLastDelivered([delivered, lastOrder].filter((o): o is WorkOrderRow => o !== null)),
  };
}

/** The ordered lines of one order plus the current public rows of those products (throws on a failed or empty read). */
export async function loadReorderInputs(orderId: string): Promise<{ lines: { part_sku: string; part_name: string; quantity: number }[]; parts: ReorderPart[] }> {
  const supabase = await loadSupabase();
  const items = await supabase.from("part_order_items").select("part_sku, part_name, quantity").eq("order_id", orderId);
  if (items.error) throw items.error;
  const lines = items.data ?? [];
  if (lines.length === 0) throw new Error("empty order");

  const skus = [...new Set(lines.map((l) => l.part_sku))];
  // Only public columns, only published products (cost and margin are never read).
  let res: { data: unknown; error: unknown } = await supabase.from("parts").select(REORDER_PART_COLUMNS).in("sku", skus).eq("is_published", true);
  if (res.error) {
    // merged_into arrives with migration 0030.
    res = await supabase.from("parts").select("id, sku, name, name_ar, min_order_qty, is_published").in("sku", skus).eq("is_published", true);
  }
  if (res.error) throw res.error;
  return { lines, parts: (res.data ?? []) as ReorderPart[] };
}
