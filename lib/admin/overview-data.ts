import "server-only";

// The queries behind the admin "Today" overview (components/dashboard/admin-overview.tsx):
// counts, latest leads and orders, the 30-day funnel, the price-experiment cohorts
// and the chat-plugin funnel. Moved out of the component unchanged (R11); the
// caller passes the cookie (RLS) server client, so the admin sees every row.

import type { DbClient } from "@/lib/supabase/db";
import { DAY_MS } from "@/lib/format/date";
import { OPEN_ORDER_STATUSES } from "@/lib/orders/status";
import { parseCohortFunnel, type CohortFunnelRow } from "@/lib/pricing/experiment";
import { loadPluginFunnel, type PluginFunnel } from "@/lib/admin/plugin-funnel";

export type OverviewLead = { id: string; name: string | null; phone: string | null; message: string | null; created_at: string; status: string | null };
export type OverviewOrder = {
  id: string;
  customer_name: string | null;
  total_qar: number | null;
  status: string;
  created_at: string;
  payment_method: string | null;
};

export type OverviewData = {
  newLeads: number;
  openOrders: number;
  requests: number;
  gaps: number;
  activeProjects: number;
  onRequest: number;
  leads: OverviewLead[];
  orders: OverviewOrder[];
  fProjects: number;
  fBoms: number;
  fCircuits: number;
  fCad: number;
  fOrders: number;
  fKitOrders: number;
  fDelivered: number;
  fSpends: number;
  fRedemptions: number;
  priceCohorts: CohortFunnelRow[];
  pluginFunnel: PluginFunnel | null;
};

export async function loadOverviewData(db: DbClient): Promise<OverviewData> {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const monthAgo = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);

  const [
    newLeads,
    openOrders,
    requests,
    gaps,
    activeProjects,
    onRequest,
    leads,
    orders,
    fProjects,
    fBoms,
    fCircuits,
    fCad,
    fOrders,
    fKitOrders,
    fDelivered,
    fSpends,
    fRedemptions,
  ] = await Promise.all([
    count(db.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new")),
    count(
      db
        .from("part_orders")
        .select("id", { count: "exact", head: true })
        .in("status", OPEN_ORDER_STATUSES)
        .not("is_test", "is", true)
    ),
    count(db.from("demand_signals").select("id", { count: "exact", head: true }).eq("kind", "request").is("served_at", null)),
    count(db.from("sourcing_gaps").select("id", { count: "exact", head: true })),
    count(db.from("projects").select("id", { count: "exact", head: true }).gte("updated_at", weekAgo).not("is_test", "is", true)),
    count(
      db
        .from("parts")
        .select("id", { count: "exact", head: true })
        .eq("is_published", true)
        .is("merged_into", null)
        .is("lead_time_class", null)
    ),
    db.from("inquiries").select("id, name, phone, message, created_at, status").order("created_at", { ascending: false }).limit(5),
    db
      .from("part_orders")
      .select("id, customer_name, total_qar, status, created_at, payment_method")
      .not("is_test", "is", true)
      .order("created_at", { ascending: false })
      .limit(5),
    // Funnel (P1-08): last 30 days, one head-count query per figure. The server
    // client applies RLS, and the admin sees every row. Test projects/orders left out.
    count(db.from("projects").select("id", { count: "exact", head: true }).gte("created_at", monthAgo).not("is_test", "is", true)),
    count(
      db.from("analysis_runs").select("id", { count: "exact", head: true }).eq("feature", "analyse").eq("outcome", "ok").gte("created_at", monthAgo)
    ),
    count(
      db.from("analysis_runs").select("id", { count: "exact", head: true }).eq("feature", "netlist").eq("outcome", "ok").gte("created_at", monthAgo)
    ),
    count(db.from("cad_generations").select("id", { count: "exact", head: true }).eq("status", "delivered").gte("delivered_at", monthAgo)),
    count(db.from("part_orders").select("id", { count: "exact", head: true }).gte("created_at", monthAgo).not("is_test", "is", true)),
    // P3-06 kit attach rate: orders holding at least one kit line (inner join, so one count per order).
    count(
      db
        .from("part_orders")
        .select("id, part_order_items!inner(kit_id)", { count: "exact", head: true })
        .not("part_order_items.kit_id", "is", null)
        .gte("created_at", monthAgo)
        .not("is_test", "is", true)
    ),
    count(
      db
        .from("part_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "delivered")
        .gte("created_at", monthAgo)
        .not("is_test", "is", true)
    ),
    count(db.from("credits_ledger").select("id", { count: "exact", head: true }).like("reason", "spend:%").gte("created_at", monthAgo)),
    count(db.from("credits_ledger").select("id", { count: "exact", head: true }).like("reason", "redeemed:%").gte("created_at", monthAgo)),
  ]);

  // Price experiment (P4-02): per invite-code cohort. Missing before 0060 (PGRST202) or
  // not a super admin = no rows, and the block below is not rendered.
  const priceCohorts: CohortFunnelRow[] = await Promise.resolve(db.rpc("price_cohort_funnel")).then(
    (r) => (r.error ? [] : parseCohortFunnel(r.data)),
    () => [],
  );

  // Chat plugin handoffs (0112): hidden when the table is missing.
  const pluginFunnel = await loadPluginFunnel(db, monthAgo);

  return {
    newLeads,
    openOrders,
    requests,
    gaps,
    activeProjects,
    onRequest,
    leads: leads.data ?? [],
    orders: orders.data ?? [],
    fProjects,
    fBoms,
    fCircuits,
    fCad,
    fOrders,
    fKitOrders,
    fDelivered,
    fSpends,
    fRedemptions,
    priceCohorts,
    pluginFunnel,
  };
}
