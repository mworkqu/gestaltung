import { isAuthorizedCron } from "@/lib/notifications/links";
import { runCronRoute } from "@/lib/cron/route";

// CAD Champions payments cron (Prompt 10 Steps D + F):
//   - awaiting_transfer payments past expires_at (48 h) -> expired; the held
//     in-person seat is released (cc_cohort_seats counts only live holds) and
//     the student gets an email;
//   - enrollment reminders 7 days and 1 day before expiry (once each);
//   - active enrollments past ends_at -> status expired.
// Auth: Authorization: Bearer $CRON_SECRET (same as the other crons).
// NOT in vercel.json yet (Hobby plan cron limits): add
//   { "path": "/api/cron/cc-payments-expire", "schedule": "0 * * * *" }  (Pro, hourly)
// or a daily schedule on Hobby (then a reservation can live up to ~24 h past 48 h).
// The Mac Mini worker runs it hourly once it is switched on (docs/WORKER.md).
//
// After the payments run it also runs the monitoring check (grading errors > 3 in the
// last hour, review items older than 48 h) and emails CC_ALERT_EMAIL. See docs/cad-champions/DEPLOY.md.
//
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" <origin>/api/cron/cc-payments-expire
// The job itself is lib/cron/jobs.ts (shared with the Mac Mini worker,
// docs/WORKER.md); lib/cron/route.ts runs it here or forwards it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_secret_unset" }, { status: 500 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) return new Response(null, { status: 401 });
  return runCronRoute("cc-payments-expire", request);
}
