import { createServiceClient } from "@/lib/supabase/service";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runVoltaatSync } from "@/lib/sourcing/voltaat-sync";
import { revalidateCatalogChange } from "@/lib/cache/storefront";
import { jsonError, jsonOk } from "@/lib/http";

// Daily Voltaat price sync (vercel.json cron). Vercel sends CRON_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const db = createServiceClient();
  if (!db) return jsonError("no_service_key", 500);
  const result = await runVoltaatSync(db, "cron");
  // Purge only what moved: "part-<sku>" per product whose offer changed,
  // "parts-listing" only when a listed field moved, one full "parts" purge past
  // the cap (lib/cache/catalog-tags.ts). A whole-store purge re-rendered ~2,600
  // product pages (Vercel ISR writes). Unchanged pages still expire on their
  // own after 24 h (STOREFRONT_REVALIDATE).
  const purged = revalidateCatalogChange(result.storefront);
  return jsonOk({ ...result, purged });
}
