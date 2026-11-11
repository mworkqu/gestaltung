import { isAuthorizedCron } from "@/lib/auth/cron";
import { runCronRoute } from "@/lib/cron/route";
import { jsonError } from "@/lib/http";

// Daily Voltaat price sync (vercel.json cron). Vercel sends CRON_SECRET.
// Purges only what moved (lib/cache/catalog-tags.ts).
// The job itself is lib/cron/jobs.ts (shared with the Mac Mini worker,
// docs/WORKER.md); lib/cron/route.ts runs it here or forwards it.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  return runCronRoute("voltaat-sync", request);
}
