import { createServiceClient } from "@/lib/supabase/service";
import { siteUrlFor } from "@/lib/projects/recovery";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { drainOutbox } from "@/lib/notifications/drain";
import { jsonError, jsonOk } from "@/lib/http";

// Drains notification_outbox (0046) once a day (vercel.json cron; Hobby-safe).
// The rules live in lib/notifications/drain.ts (also called right after an
// admin order status change, so order emails do not wait for this run).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 50;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const db = createServiceClient();
  if (!db) return jsonError("no_service_key", 500);

  const result = await drainOutbox(db, siteUrlFor(request.url), BATCH);
  if (!result.ok) return Response.json({ error: result.error, detail: result.detail }, { status: 500 });
  return jsonOk(result.summary);
}
