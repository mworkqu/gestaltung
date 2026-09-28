import { getSessionContext } from "@/lib/auth/get-session";
import { createServiceClient } from "@/lib/supabase/service";
import { runVoltaatSync } from "@/lib/sourcing/voltaat-sync";

// "Run now" from the admin. Same rules as the daily run (including one run a day).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });
  return Response.json(await runVoltaatSync(db, "manual"));
}
