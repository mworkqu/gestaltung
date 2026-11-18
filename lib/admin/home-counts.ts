import "server-only";

// The two list reads behind the admin Home tiles "Reply" and "Confirm"
// (components/dashboard/admin-home.tsx), moved out of the component unchanged
// (R11). Each resolves to a count, or null when the read failed (the tile then
// shows a dash, never a wrong 0).

import { countConfirm, countReply, ORDER_STATUSES_TO_HANDLE } from "@/lib/admin/home-tiles";
import type { DbClient } from "@/lib/supabase/db";

export function loadReplyCount(db: DbClient): Promise<number | null> {
  return Promise.resolve(
    db.from("inquiries").select("id, name, message, status, is_test").eq("status", "new").limit(1000)
  ).then(
    (r) => (r.error ? null : countReply(r.data ?? [])),
    () => null
  );
}

export function loadConfirmCount(db: DbClient): Promise<number | null> {
  return Promise.resolve(
    db
      .from("part_orders")
      .select("id, status, customer_name, is_test")
      .in("status", [...ORDER_STATUSES_TO_HANDLE])
      .not("is_test", "is", true) // orders marked as test (D3) never count; countConfirm also drops TEST-looking rows
      .limit(1000)
  ).then(
    (r) => (r.error ? null : countConfirm(r.data ?? [])),
    () => null
  );
}
