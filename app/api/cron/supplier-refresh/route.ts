import { createServiceClient } from "@/lib/supabase/service";
import { refreshChangedSomething, runApiRefresh } from "@/lib/sourcing/api-refresh";
import { revalidateStorefront } from "@/lib/cache/storefront";

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
  const result = await runApiRefresh(db, "cron");
  // Purge only when an offer's numbers moved (see voltaat-sync for why).
  if (refreshChangedSomething(result)) revalidateStorefront();
  return Response.json(result);
}
