import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email";
import { confirmationEmail, type OrderForEmail } from "@/lib/store/order-email";

// Order confirmation email with the promised date(s) (Task 18d). Called by
// checkout right after create_part_order. A guest can't read their own order
// under RLS, so this reads it with the service key — but only a fresh order
// (< 1 h old) that hasn't been emailed yet, so the order id alone can't be
// used to send anything twice or to someone later.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" && /^[0-9a-f-]{36}$/i.test(body.orderId) ? body.orderId : null;
  if (!orderId) return new Response(null, { status: 400 });

  const db = createServiceClient();
  if (!db) return Response.json({ sent: false, reason: "no_service_key" });

  const { data: order } = await db.from("part_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || !order.customer_email || order.confirmation_emailed_at) return Response.json({ sent: false });
  if (Date.now() - new Date(order.created_at).getTime() > 60 * 60 * 1000) return Response.json({ sent: false });

  // Claim it first so a double call can't send twice.
  const { data: claimed } = await db
    .from("part_orders")
    .update({ confirmation_emailed_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("confirmation_emailed_at", null)
    .select("id");
  if (!claimed?.length) return Response.json({ sent: false });

  const { data: items } = await db
    .from("part_order_items")
    .select("part_name, quantity, unit_price_qar, lead_time_class")
    .eq("order_id", orderId);
  const mail = confirmationEmail(order as OrderForEmail, items ?? []);
  const sent = await sendEmail({ to: [order.customer_email], ...mail });
  if (!sent) await db.from("part_orders").update({ confirmation_emailed_at: null }).eq("id", orderId);
  return Response.json({ sent });
}
