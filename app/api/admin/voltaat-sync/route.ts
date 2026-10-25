import { getSessionContext } from "@/lib/auth/get-session";
import { createServiceClient } from "@/lib/supabase/service";
import { runVoltaatSync } from "@/lib/sourcing/voltaat-sync";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { isSuperAdminSession } from "@/lib/auth/guards";
import { emptyStatus, jsonError, jsonOk } from "@/lib/http";

// "Run now" from the admin. Same rules as the daily run (including one run a day).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await getSessionContext();
  if (!isSuperAdminSession(session)) return emptyStatus(403);
  const db = createServiceClient();
  if (!db) return jsonError("no_service_key", 500);
  const result = await runVoltaatSync(db, "manual");
  revalidateStorefront();
  return jsonOk(result);
}
