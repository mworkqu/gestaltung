import { isAuthorizedCron } from "@/lib/notifications/links";
import { sendWeeklyProgressEmails } from "@/lib/cad-champions/training/weekly-email";

// Weekly CAD Champions training progress email (Prompt 9 Step E).
// Auth: Authorization: Bearer $CRON_SECRET (same as the other crons).
// NOT in vercel.json yet (Hobby plan cron limits): the schedule line to add
// is documented in docs/cad-champions/TRAINING.md. Sends at most once per
// student per Qatar week (Resend Idempotency-Key), only to students who have
// started training and kept cc_profiles.weekly_progress_email on.
//
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" <origin>/api/cron/cc-weekly-progress

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_secret_unset" }, { status: 500 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) return new Response(null, { status: 401 });
  const result = await sendWeeklyProgressEmails();
  if ("error" in result) {
    console.error("[cc-weekly] run failed:", result.error);
    return Response.json(result, { status: 500 });
  }
  console.log("[cc-weekly] run:", JSON.stringify(result));
  return Response.json(result);
}
