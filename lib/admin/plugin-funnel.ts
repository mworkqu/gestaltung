import "server-only";

// Admin Funnel card: chat-plugin handoffs of the last 30 days (migration 0112).
// Returns null when the table is missing or unreadable, so the card hides the
// rows instead of failing. Untyped client: see plugin-handoff-server.ts.

type Res = PromiseLike<{ data: unknown; error: unknown; count?: number | null }>;
type Q = {
  select: (cols: string, opts?: { count: "exact"; head: true }) => Q;
  gte: (c: string, v: string) => Q;
  not: (c: string, op: string, v: unknown) => Q;
  in: (c: string, v: string[]) => Q;
  limit: (n: number) => Res;
} & Res;
type Loose = { from: (t: string) => Q };

export type PluginFunnel = { sent: number; claimed: number; ordered: number };

export async function loadPluginFunnel(db: unknown, sinceIso: string): Promise<PluginFunnel | null> {
  const c = db as Loose;
  try {
    // is_test may not exist on the table: try with the exclusion, then without.
    const base = (claimedOnly: boolean, excludeTest: boolean) => {
      let q = c.from("plugin_handoffs").select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
      if (claimedOnly) q = q.not("claimed_at", "is", null);
      if (excludeTest) q = q.not("is_test", "is", true);
      return q;
    };
    let excludeTest = true;
    let sent = await base(false, true);
    if (sent.error) {
      excludeTest = false;
      sent = await base(false, false);
      if (sent.error) return null;
    }
    const claimed = await base(true, excludeTest);

    let ordered = 0;
    const ids = await c
      .from("plugin_handoffs")
      .select("project_id")
      .gte("created_at", sinceIso)
      .not("project_id", "is", null)
      .limit(1000);
    const projectIds = Array.isArray(ids.data)
      ? (ids.data as { project_id: string | null }[]).map((r) => r.project_id).filter((v): v is string => !!v)
      : [];
    if (projectIds.length > 0) {
      const items = await c
        .from("part_order_items")
        .select("order_id, project_id, part_orders!inner(status, is_test)")
        .in("project_id", projectIds)
        .not("part_orders.status", "eq", "cancelled")
        .not("part_orders.is_test", "is", true)
        .limit(5000);
      if (Array.isArray(items.data)) ordered = new Set((items.data as { project_id: string }[]).map((r) => r.project_id)).size;
    }
    return { sent: sent.count ?? 0, claimed: claimed.error ? 0 : (claimed.count ?? 0), ordered };
  } catch {
    return null;
  }
}
