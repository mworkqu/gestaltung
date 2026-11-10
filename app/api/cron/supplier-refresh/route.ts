import { createServiceClient } from "@/lib/supabase/service";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runApiRefresh } from "@/lib/sourcing/api-refresh";
import { revalidateCatalogChange } from "@/lib/cache/storefront";
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
  // Purge only what moved, per product (see voltaat-sync for why).
  const purged = revalidateCatalogChange(result.storefront);
  return jsonOk({ ...result, purged });
}
