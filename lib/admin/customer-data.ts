// Every table that holds one customer's data, read in one place for both the
// /dashboard/customers/<id> page and the JSON export (lib/admin/customer-export.ts).
// Server-only (the caller passes a super_admin RLS client).
//
// Every read is soft: a failed section comes back null and is reported through
// `onError` at the moment it fails, so each caller words it its own way (the
// page shows a translated line, the export writes `_notes`). The callers differ
// only in a few column lists, passed as `columns`.
//
// cart_items is absent on purpose: it has no super_admin policy (0016).

import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerRow = Record<string, unknown>;

export type CustomerQueryError = { message: string; code?: string };

/** Section keys, in the order the page shows them. */
export type CustomerSection =
  | "profile"
  | "projects"
  | "orders"
  | "leads"
  | "ledger"
  | "payments"
  | "pass"
  | "sessions"
  | "usage"
  | "jobs"
  | "cad"
  | "signals"
  | "outbox"
  | "items";

export type CustomerBundle = {
  profile: CustomerRow | null;
  projects: CustomerRow[] | null;
  orders: CustomerRow[] | null;
  /** The newest LEAD_LIMIT inquiries (no user_id on inquiries: callers match them). */
  leadRows: CustomerRow[] | null;
  ledger: CustomerRow[] | null;
  payments: CustomerRow[] | null;
  pass: CustomerRow | null;
  sessions: CustomerRow[] | null;
  usage: CustomerRow[] | null;
  jobs: CustomerRow[] | null;
  cad: CustomerRow[] | null;
  signals: CustomerRow[] | null;
  outbox: CustomerRow[] | null;
  /** Lines of the orders above ([] when there are none). */
  items: CustomerRow[] | null;
};

/** inquiries carry no user_id, so the newest this many are read and matched. */
export const LEAD_LIMIT = 4000;
const USAGE_LIMIT = 20000;

export async function loadCustomerBundle(
  db: SupabaseClient,
  userId: string,
  opts: {
    onError: (section: CustomerSection, error: CustomerQueryError) => void;
    /** select() lists per table; "*" when absent. */
    columns?: { projects?: string; orders?: string; usage?: string };
  },
): Promise<CustomerBundle> {
  const soft = async <T>(section: CustomerSection, q: PromiseLike<{ data: T | null; error: CustomerQueryError | null }>): Promise<T | null> => {
    const { data, error } = await q;
    if (error) {
      opts.onError(section, error);
      return null;
    }
    return data;
  };
  const cols = opts.columns ?? {};
  // A column list from the caller; typed as "*" so every section stays a plain row (type-only cast).
  const sel = (list: string | undefined) => (list ?? "*") as "*";

  const profile = await soft<CustomerRow>("profile", db.from("profiles").select("*").eq("id", userId).maybeSingle());

  const [projects, orders, leadRows, ledger, payments, pass, sessions, usage, jobs, cad, signals, outbox] = await Promise.all([
    soft<CustomerRow[]>(
      "projects",
      db.from("projects").select(sel(cols.projects)).eq("user_id", userId).order("created_at", { ascending: false }),
    ),
    soft<CustomerRow[]>(
      "orders",
      db.from("part_orders").select(sel(cols.orders)).eq("profile_id", userId).order("created_at", { ascending: false }),
    ),
    soft<CustomerRow[]>("leads", db.from("inquiries").select("*").order("created_at", { ascending: false }).limit(LEAD_LIMIT)),
    soft<CustomerRow[]>("ledger", db.from("credits_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    soft<CustomerRow[]>("payments", db.from("payments").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    soft<CustomerRow>("pass", db.from("idea_passes").select("*").eq("user_id", userId).maybeSingle()),
    soft<CustomerRow[]>("sessions", db.from("idea_sessions").select("*").eq("user_id", userId).order("updated_at", { ascending: false })),
    soft<CustomerRow[]>(
      "usage",
      db
        .from("ai_usage")
        .select(sel(cols.usage))
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(USAGE_LIMIT),
    ),
    soft<CustomerRow[]>("jobs", db.from("engineering_jobs").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    soft<CustomerRow[]>("cad", db.from("cad_generations").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    soft<CustomerRow[]>("signals", db.from("demand_signals").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    soft<CustomerRow[]>("outbox", db.from("notification_outbox").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
  ]);

  const orderIds = (orders ?? []).map((o) => String(o.id));
  const items = orderIds.length
    ? await soft<CustomerRow[]>("items", db.from("part_order_items").select("*").in("order_id", orderIds))
    : [];

  return { profile, projects, orders, leadRows, ledger, payments, pass, sessions, usage, jobs, cad, signals, outbox, items };
}
