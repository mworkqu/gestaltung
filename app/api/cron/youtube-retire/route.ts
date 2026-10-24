import { runRetirements } from "@/lib/integrations/youtube-retire";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { jsonError, jsonOk } from "@/lib/http";

// Daily retire-log run (vercel.json cron, 07:00 UTC = 10:00 Qatar, right after
// Google resets the YouTube quota). Deletes the outdated videos whose grace
// period is over from YouTube and from the site's links. Vercel sends CRON_SECRET.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const result = await runRetirements();
  return jsonOk(result);
}
