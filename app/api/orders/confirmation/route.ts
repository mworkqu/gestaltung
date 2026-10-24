import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email";
import { confirmationEmail, type OrderForEmail } from "@/lib/store/order-email";
import { HOLIDAYS_KEY } from "@/lib/store/working-days";
import { asLocale } from "@/lib/locale";
import { claimConfirmation, confirmationAllowed, releaseConfirmation } from "@/lib/orders/confirmation-window";
import { jsonOk } from "@/lib/http";

// Order confirmation email with the promised date(s) (Task 18d). Called by
// checkout right after create_part_order. A guest can't read their own order
// under RLS, so this reads it with the service key — but only a fresh order
// (< 1 h old) that hasn't been emailed yet, so the order id alone can't be
// used to send anything twice or to someone later.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; locale?: unknown } | null;
  const orderId = typeof body?.orderId === "string" && /^[0-9a-f-]{36}$/i.test(body.orderId) ? body.orderId : null;
  if (!orderId) return new Response(null, { status: 400 });
  // Both languages are always in the mail; the checkout language only decides which half leads.
  const locale = asLocale(body?.locale);

  const db = createServiceClient();
  if (!db) return jsonOk({ sent: false, reason: "no_service_key" });

  const { data: order } = await db.from("part_orders").select("*").eq("id", orderId).maybeSingle();
  if (!confirmationAllowed(order, Date.now())) return jsonOk({ sent: false });

  // Claim it first so a double call can't send twice.
  if (!(await claimConfirmation(db, orderId, new Date()))) return jsonOk({ sent: false });

  const { data: items } = await db
    .from("part_order_items")
    .select("part_id, part_name, quantity, unit_price_qar, lead_time_class")
    .eq("order_id", orderId);
  // The order snapshot keeps only the English name; the Arabic half of the mail uses the catalogue's Arabic name.
  const partIds = Array.from(new Set((items ?? []).map((i) => i.part_id).filter((id): id is string => typeof id === "string")));
  const { data: arNames } = partIds.length
    ? await db.from("parts").select("id, name_ar").in("id", partIds)
    : { data: [] as { id: string; name_ar: string | null }[] };
  const arById = new Map((arNames ?? []).map((p) => [p.id, p.name_ar] as const));
  // 0054: the promised dates are working-day dates once store_settings.holidays exists.
  const { data: holidaysRow } = await db.from("store_settings").select("key").eq("key", HOLIDAYS_KEY).maybeSingle();
  const mail = confirmationEmail(
    order as OrderForEmail,
    (items ?? []).map(({ part_id, ...i }) => ({ ...i, part_name_ar: part_id ? arById.get(part_id) ?? null : null })),
    locale,
    { workingDays: Boolean(holidaysRow) },
  );
  const sent = await sendEmail({ to: [order.customer_email], ...mail });
  if (!sent) await releaseConfirmation(db, orderId);
  return jsonOk({ sent });
}
