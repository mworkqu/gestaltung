import { isAuthorizedCron } from "@/lib/notifications/links";
import { runCronRoute } from "@/lib/cron/route";

// Weekly CAD Champions training progress email (Prompt 9 Step E).
// Auth: Authorization: Bearer $CRON_SECRET (same as the other crons).
// NOT in vercel.json yet (Hobby plan cron limits): the schedule line to add
// is documented in docs/cad-champions/TRAINING.md; the Mac Mini worker runs
// it weekly once it is switched on (docs/WORKER.md). Sends at most once per
// student per Qatar week (Resend Idempotency-Key), only to students who have
// started training and kept cc_profiles.weekly_progress_email on.
//
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" <origin>/api/cron/cc-weekly-progress
// The job itself is lib/cron/jobs.ts (shared with the Mac Mini worker,
// docs/WORKER.md); lib/cron/route.ts runs it here or forwards it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_secret_unset" }, { status: 500 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) return new Response(null, { status: 401 });
  return runCronRoute("cc-weekly-progress", request);
}
