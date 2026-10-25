import { createServiceClient } from "@/lib/supabase/service";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { refreshChangedSomething, runApiRefresh } from "@/lib/sourcing/api-refresh";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { jsonError, jsonOk } from "@/lib/http";

// Daily Mouser + DigiKey refresh (vercel.json cron). Vercel sends CRON_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const db = createServiceClient();
  if (!db) return jsonError("no_service_key", 500);
  const result = await runApiRefresh(db, "cron");
  // Purge only when an offer's numbers moved (see voltaat-sync for why).
  if (refreshChangedSomething(result)) revalidateStorefront();
  return jsonOk(result);
}
