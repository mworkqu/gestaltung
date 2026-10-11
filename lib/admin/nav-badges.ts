// "Something to do" counts for the dashboard sidebar (D2): Orders waiting,
// products to fix, new messages, reviews to approve. One round of queries,
// run in parallel; the layout streams the result into the sidebar so the page
// never waits for it. A count that cannot be read is left out (no badge),
// never shown as a wrong number.

import type { createClient } from "@/lib/supabase/server";
import { ORDER_STATUSES_TO_HANDLE } from "@/lib/admin/home-tiles";
import { loadFixParts } from "@/lib/admin/fix-data";
import type { NavBadges } from "@/lib/admin/nav";

type Db = Awaited<ReturnType<typeof createClient>>;

type CountResult = { count: number | null; error: unknown };

function headCount(q: PromiseLike<CountResult>): Promise<number | null> {
  return Promise.resolve(q).then(
    (r) => (r.error ? null : (r.count ?? 0)),
    () => null
  );
}

export async function loadNavBadges(db: Db): Promise<NavBadges> {
  const [orders, leads, reviews, fix] = await Promise.all([
    // Same statuses as the Home "Confirm" tile (head count: is_test rows left out).
    headCount(
      db
        .from("part_orders")
        .select("id", { count: "exact", head: true })
        .in("status", [...ORDER_STATUSES_TO_HANDLE])
        .not("is_test", "is", true)
    ),
    // New messages, like the Home "Reply" tile (head count: is_test rows left out).
    headCount(db.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new").not("is_test", "is", true)),
    headCount(db.from("reviews").select("id", { count: "exact", head: true }).eq("status", "pending")),
    // Same list as the Fix page and the Home "Fix" tile, so the numbers agree.
    loadFixParts(db).then(
      (items) => (items ? items.length : null),
      () => null
    ),
  ]);
  return badgesFrom({ orders, leads, reviews, fix });
}

/** Drops unknown counts (null) so they render no badge. */
export function badgesFrom(raw: Record<keyof NavBadges, number | null>): NavBadges {
  const out: NavBadges = {};
  for (const [k, v] of Object.entries(raw) as [keyof NavBadges, number | null][]) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
