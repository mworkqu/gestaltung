import { isAuthorizedCron } from "@/lib/auth/cron";
import { runCronRoute } from "@/lib/cron/route";
import { jsonError } from "@/lib/http";

// Weekly anonymous-user cleanup (P2-09, FINDINGS #7): vercel.json cron, Sunday
// 05:00 UTC. Reads store_settings.anonymous_cleanup ({enabled, dry_run, days};
// 0055 seeds a DRY RUN) and calls cleanup_anonymous_users (0055); the owner gets
// a one-line email only when accounts were actually deleted
// (lib/cron/anonymous-cleanup.ts).
//
// Manual dry run: curl -H "Authorization: Bearer $CRON_SECRET" <origin>/api/cron/anonymous-cleanup
// (it uses the stored dry_run; the default is a dry run).
// The job itself is lib/cron/jobs.ts (shared with the Mac Mini worker,
// docs/WORKER.md); lib/cron/route.ts runs it here or forwards it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  return runCronRoute("anonymous-cleanup", request);
}
