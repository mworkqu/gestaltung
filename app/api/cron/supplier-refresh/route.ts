import { createServiceClient } from "@/lib/supabase/service";
import { runApiRefresh } from "@/lib/sourcing/api-refresh";

// Daily Mouser + DigiKey refresh (vercel.json cron). Vercel sends CRON_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });
  return Response.json(await runApiRefresh(db, "cron"));
}
