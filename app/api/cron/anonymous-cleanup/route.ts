import { createServiceClient } from "@/lib/supabase/service";
import { isAuthorizedCron } from "@/lib/notifications/links";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import {
  CLEANUP_KEY,
  parseCleanupResult,
  parseCleanupSettings,
  shouldEmail,
  summaryLine,
} from "@/lib/cleanup/anonymous";

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
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_secret_unset" }, { status: 500 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });

  const { data: row, error: readError } = await db
    .from("store_settings")
    .select("value")
    .eq("key", CLEANUP_KEY)
    .maybeSingle();
  if (readError) {
    console.error("[anonymous-cleanup] settings read failed:", readError.message);
    return Response.json({ error: "settings_read_failed" }, { status: 500 });
  }
  const settings = parseCleanupSettings(row?.value);
  if (!settings.enabled) {
    console.log("[anonymous-cleanup] switched off — skipped");
    return Response.json({ skipped: "disabled" });
  }

  const { data, error } = await db.rpc("cleanup_anonymous_users", {
    p_dry_run: settings.dryRun,
    p_days: settings.days,
  });
  if (error) {
    if (missing(error)) return Response.json({ error: "run_0055" }, { status: 500 });
    console.error("[anonymous-cleanup] failed:", error.message);
    return Response.json({ error: "cleanup_failed", detail: error.message }, { status: 500 });
  }
  const result = parseCleanupResult(data);
  if (!result) return Response.json({ error: "unexpected_result" }, { status: 500 });

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
