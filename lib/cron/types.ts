// Shared shapes for the scheduled jobs (lib/cron/jobs.ts). Pure.

import type { SupabaseClient } from "@supabase/supabase-js";

/** What a cron job answers: exactly the HTTP status + JSON body of its Vercel route. */
export type CronOutcome = { status: number; body: unknown };

/**
 * What a job needs from its caller. The Vercel route passes the in-Vercel
 * versions (service client, revalidateTag, the cached contact number); the
 * worker passes its own (service client, POST /api/internal/revalidate, a
 * direct read). No next/* import may reach a job through these.
 */
export type CronDeps = {
  /** createServiceClient(): null when SUPABASE_SERVICE_ROLE_KEY is missing. */
  db: () => SupabaseClient | null;
  /** Origin for links in emails. */
  siteUrl: string;
  /** Purge storefront cache tags; returns the tags purged. */
  purge: (tags: readonly string[]) => string[] | Promise<string[]>;
  /** Load the current contact number for email footers (lib/contact-phone-current). */
  refreshContactPhone: () => Promise<unknown>;
};
