// Engineer services — server side (migration 0092). Server-only.
// The price is recomputed here from the saved Studio doc and the admin's prices;
// the browser only names the service and the project.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { StudioDocSchema, type StudioDoc } from "@/lib/studio/schema";
import type { PaymentRow } from "@/lib/billing/server";
import { ENGINEER_SERVICES_KEY, parseEngineerServices, quoteService, serviceReady, type EngineerServices, type Quote, type ServiceKind } from "./quote";

/** The admin's prices (store_settings 'engineer_services'), else the defaults. */
export async function engineerServicePrices(supabase: SupabaseClient): Promise<EngineerServices> {
  const db = createServiceClient() ?? supabase;
  const { data } = await db.from("store_settings").select("value").eq("key", ENGINEER_SERVICES_KEY).maybeSingle();
  return parseEngineerServices(data?.value);
}

export async function projectDoc(supabase: SupabaseClient, projectId: string): Promise<{ name: string; doc: StudioDoc | null } | null> {
  const { data } = await supabase.from("projects").select("name, studio").eq("id", projectId).maybeSingle();
  if (!data) return null;
  const parsed = StudioDocSchema.safeParse(data.studio);
  return { name: String(data.name ?? ""), doc: parsed.success ? parsed.data : null };
}

export type ServicePaymentResult =
  | { ok: true; payment: PaymentRow; quote: Quote }
  | { ok: false; error: "not_found" | "not_ready" | "already_open" | "not_configured" | "failed" };

export async function createServicePayment(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  kind: ServiceKind,
  note: string,
): Promise<ServicePaymentResult> {
  const service = createServiceClient();
  if (!service) return { ok: false, error: "not_configured" };
  const project = await projectDoc(supabase, projectId);
  if (!project) return { ok: false, error: "not_found" };
  if (!serviceReady(kind, project.doc)) return { ok: false, error: "not_ready" };
  const quote = quoteService(kind, project.doc!, await engineerServicePrices(supabase));
  const { data, error } = await service.rpc("payment_create_service", {
    p_user: userId,
    p_service: kind,
    p_amount: quote.total_qar,
    p_project: projectId,
    p_meta: { quote, note: note.slice(0, 1000), snapshot: { name: project.name, studio: project.doc } },
    p_is_test: false,
  });
  if (error) {
    const known = (["not_found", "already_open"] as const).find((c) => error.message.includes(c));
    if (!known) console.error("[services] payment_create_service failed:", error.message);
    return { ok: false, error: known ?? (/could not find the function|PGRST202/i.test(error.message) ? "not_configured" : "failed") };
  }
  return { ok: true, payment: data as PaymentRow, quote };
}
