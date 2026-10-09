import { createServiceClient } from "@/lib/supabase/service";
import { siteUrlFor } from "@/lib/projects/recovery";
import { isAuthorizedCron } from "@/lib/notifications/links";
import { drainOutbox } from "@/lib/notifications/drain";

// Drains notification_outbox (0046) once a day (vercel.json cron; Hobby-safe).
// The rules live in lib/notifications/drain.ts (also called right after an
// admin order status change, so order emails do not wait for this run).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 50;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_secret_unset" }, { status: 500 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });

  const result = await drainOutbox(db, siteUrlFor(request.url), BATCH);
  if (!result.ok) return Response.json({ error: result.error, detail: result.detail }, { status: 500 });
  return Response.json(result.summary);
}
