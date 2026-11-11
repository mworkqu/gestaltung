// Drains notification_outbox (0046). The rules are in drain-core.ts (shared
// with the Mac Mini worker); this wrapper supplies the cached server read of
// the contact number for the email footers, as before the split. Used by the
// daily cron (app/api/cron/notifications, through lib/cron/jobs.ts) and right
// after an admin status change by the orders server action (after()).

import type { SupabaseClient } from "@supabase/supabase-js";

import { getContactPhone } from "@/lib/contact-phone-server";
import { drainOutboxWith, type DrainResult } from "@/lib/notifications/drain-core";

export type { ClaimedRow, DrainResult, DrainSummary } from "@/lib/notifications/drain-core";

export function drainOutbox(db: SupabaseClient, siteUrl: string, limit = 50): Promise<DrainResult> {
  return drainOutboxWith(db, siteUrl, limit, getContactPhone);
}
