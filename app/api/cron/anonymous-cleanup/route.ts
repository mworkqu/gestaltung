import { createServiceClient } from "@/lib/supabase/service";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import {
  CLEANUP_KEY,
  parseCleanupResult,
  parseCleanupSettings,
  shouldEmail,
  summaryLine,
} from "@/lib/cleanup/anonymous";
import { isMissingFunction } from "@/lib/supabase/errors";
import { jsonError, jsonOk } from "@/lib/http";

// Weekly anonymous-user cleanup (P2-09, FINDINGS #7): vercel.json cron, Sunday
// 05:00 UTC. Reads store_settings.anonymous_cleanup ({enabled, dry_run, days};
// 0055 seeds a DRY RUN) and calls cleanup_anonymous_users (0055, SECURITY
// DEFINER, service_role only), which logs every run in cleanup_runs. The owner
// gets a one-line email only when accounts were actually deleted.
//
// Manual dry run: curl -H "Authorization: Bearer $CRON_SECRET" <origin>/api/cron/anonymous-cleanup
// (it uses the stored dry_run; the default is a dry run).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RpcError = { code?: string; message?: string } | null;
const missing = (e: RpcError) =>
  !!e && (isMissingFunction(e) || /could not find the function/i.test(e.message ?? ""));

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const db = createServiceClient();
  if (!db) return jsonError("no_service_key", 500);

  const { data: row, error: readError } = await db
    .from("store_settings")
    .select("value")
    .eq("key", CLEANUP_KEY)
    .maybeSingle();
  if (readError) {
    console.error("[anonymous-cleanup] settings read failed:", readError.message);
    return jsonError("settings_read_failed", 500);
  }
  const settings = parseCleanupSettings(row?.value);
  if (!settings.enabled) {
    console.log("[anonymous-cleanup] switched off — skipped");
    return jsonOk({ skipped: "disabled" });
  }

  const { data, error } = await db.rpc("cleanup_anonymous_users", {
    p_dry_run: settings.dryRun,
    p_days: settings.days,
  });
  if (error) {
    if (missing(error)) return jsonError("run_0055", 500);
    console.error("[anonymous-cleanup] failed:", error.message);
    return Response.json({ error: "cleanup_failed", detail: error.message }, { status: 500 });
  }
  const result = parseCleanupResult(data);
  if (!result) return jsonError("unexpected_result", 500);

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

  return Response.json({
    dry_run: result.dryRun,
    days: result.days,
    candidates: result.candidates,
    deleted: result.deleted,
    sample: result.sample,
    emailed,
  });
}
