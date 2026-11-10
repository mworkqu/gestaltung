// Weekly anonymous-user cleanup (P2-09, FINDINGS #7), moved verbatim from
// app/api/cron/anonymous-cleanup/route.ts so the Vercel route and the Mac
// Mini worker run the same code. Reads store_settings.anonymous_cleanup
// ({enabled, dry_run, days}; 0055 seeds a DRY RUN) and calls
// cleanup_anonymous_users (0055, SECURITY DEFINER, service_role only), which
// logs every run in cleanup_runs. The owner gets a one-line email only when
// accounts were actually deleted. Returns the route's status + body.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CLEANUP_KEY,
  parseCleanupResult,
  parseCleanupSettings,
  shouldEmail,
  summaryLine,
} from "@/lib/cleanup/anonymous";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import { isMissingFunction } from "@/lib/supabase/errors";

import type { CronOutcome } from "./types";

type RpcError = { code?: string; message?: string } | null;
const missing = (e: RpcError) =>
  !!e && (isMissingFunction(e) || /could not find the function/i.test(e.message ?? ""));

export async function runAnonymousCleanup(db: SupabaseClient): Promise<CronOutcome> {
  const { data: row, error: readError } = await db
    .from("store_settings")
    .select("value")
    .eq("key", CLEANUP_KEY)
    .maybeSingle();
  if (readError) {
    console.error("[anonymous-cleanup] settings read failed:", readError.message);
    return { status: 500, body: { error: "settings_read_failed" } };
  }
  const settings = parseCleanupSettings(row?.value);
  if (!settings.enabled) {
    console.log("[anonymous-cleanup] switched off — skipped");
    return { status: 200, body: { skipped: "disabled" } };
  }

  const { data, error } = await db.rpc("cleanup_anonymous_users", {
    p_dry_run: settings.dryRun,
    p_days: settings.days,
  });
  if (error) {
    if (missing(error)) return { status: 500, body: { error: "run_0055" } };
    console.error("[anonymous-cleanup] failed:", error.message);
    return { status: 500, body: { error: "cleanup_failed", detail: error.message } };
  }
  const result = parseCleanupResult(data);
  if (!result) return { status: 500, body: { error: "unexpected_result" } };

  const line = summaryLine(result);
  console.log(`[anonymous-cleanup] ${line}`);

  let emailed = false;
  if (shouldEmail(result)) {
    emailed = await sendEmail({
      to: [OWNER_EMAIL],
      subject: `Guest cleanup: ${result.deleted} account${result.deleted === 1 ? "" : "s"} deleted`,
      ...renderOwnerEmail({
        title: "Guest account cleanup",
        paragraphs: [line, "Run log: Dashboard → AI usage & pricing → Guest account cleanup."],
      }),
    });
  }

  return {
    status: 200,
    body: {
      dry_run: result.dryRun,
      days: result.days,
      candidates: result.candidates,
      deleted: result.deleted,
      sample: result.sample,
      emailed,
    },
  };
}
