import { isAuthorizedCron } from "@/lib/auth/cron";
import { runCronRoute } from "@/lib/cron/route";
import { jsonError } from "@/lib/http";

// Drains notification_outbox (0046) once a day (vercel.json cron; Hobby-safe).
// The rules live in lib/notifications/drain-core.ts (also called right after an
// admin order status change, so order emails do not wait for this run).
// The job itself is lib/cron/jobs.ts (shared with the Mac Mini worker,
// docs/WORKER.md); lib/cron/route.ts runs it here or forwards it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  return runCronRoute("notifications", request);
}
