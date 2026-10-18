import { createServiceClient } from "@/lib/supabase/service";
import { runVoltaatSync } from "@/lib/sourcing/voltaat-sync";
import { revalidateStorefront } from "@/lib/cache/storefront";

// Daily Voltaat price sync (vercel.json cron). Vercel sends CRON_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });
  const result = await runVoltaatSync(db, "cron");
  // Purge only when prices / availability moved: an unconditional daily purge
  // re-rendered every crawled page and its cache entries (Vercel ISR writes).
  // Unchanged pages still expire on their own after 24 h (STOREFRONT_REVALIDATE).
  if (result.changed > 0 || result.dropped > 0 || result.missing > 0) revalidateStorefront();
  return Response.json(result);
}
