import { isAuthorizedCron } from "@/lib/auth/cron";
import { runCronRoute } from "@/lib/cron/route";
import { jsonError } from "@/lib/http";

// Daily retire-log run (vercel.json cron, 07:00 UTC = 10:00 Qatar, right after
// Google resets the YouTube quota). Deletes the outdated videos whose grace
// period is over from YouTube and from the site's links. Vercel sends CRON_SECRET.
// The job itself is lib/cron/jobs.ts (shared with the Mac Mini worker,
// docs/WORKER.md); lib/cron/route.ts runs it here or forwards it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  return runCronRoute("youtube-retire", request);
}
