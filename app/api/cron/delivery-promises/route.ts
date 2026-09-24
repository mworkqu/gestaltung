import { createServiceClient } from "@/lib/supabase/service";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { dateChangeEmail, type OrderForEmail } from "@/lib/store/order-email";
import { LEAD_CLASS_DAYS } from "@/lib/store/delivery";
import type { LeadTimeClass } from "@/lib/store/sourcing";

// Daily (vercel.json cron): for every open order whose promised date hasn't
// passed, compare each item's lead-time class now with the one it was sold
// at. If any changed, recompute the date the same way checkout did and email
// the customer — BEFORE the promised date, never after:
//   later date   → "new date is …" and the order's promise moves;
//   same/earlier → "your date still holds";
//   no offer now → "we can't date it yet, we'll contact you".
// Item snapshots are updated so each change is emailed once. The owner gets a
// summary of what was sent.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPEN = ["pending", "confirmed", "processing"];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: cfgRow } = await db.from("store_settings").select("value").eq("key", "shipping").maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as {
    handling_days?: number;
    buffer_days?: number;
    tiers?: Record<string, { transit_days?: number }>;
  };

  const { data: orders } = await db
    .from("part_orders")
    .select("*")
    .in("status", OPEN)
    .gte("promised_date", today)
    .limit(500);

  const report: string[] = [];
  for (const order of orders ?? []) {
    const { data: items } = await db
      .from("part_order_items")
      .select("id, part_id, part_name, lead_time_class, part:parts(lead_time_class)")
      .eq("order_id", order.id);
    type Row = { id: string; part_name: string; lead_time_class: string | null; part: { lead_time_class: string | null } | null };
    const rows = (items ?? []) as unknown as Row[];
    const changed = rows.filter((r) => r.part && r.part.lead_time_class !== r.lead_time_class);
    if (!changed.length) continue;

    const current = rows.map((r) => (r.part ? r.part.lead_time_class : r.lead_time_class));
    const undatable = current.some((c) => !c);
    const orderDate = String(order.created_at).slice(0, 10);
    const transit = cfg.tiers?.[order.shipping_tier ?? "standard"]?.transit_days ?? 0;
    const lead = Math.max(...current.map((c) => (c ? LEAD_CLASS_DAYS[c as LeadTimeClass] ?? 28 : 0)));
    const recomputed = undatable ? null : addDays(orderDate, lead + (cfg.handling_days ?? 1) + transit + (cfg.buffer_days ?? 3));
    const oldDate = order.promised_date as string;
    const newDate = recomputed === null ? null : recomputed > oldDate ? recomputed : oldDate;

    let sent = false;
    if (order.customer_email) {
      const mail = dateChangeEmail(order as OrderForEmail, oldDate, newDate, changed.map((c) => c.part_name));
      sent = await sendEmail({ to: [order.customer_email], ...mail });
    }

    for (const r of changed) {
      await db.from("part_order_items").update({ lead_time_class: r.part!.lead_time_class }).eq("id", r.id);
    }
    await db
      .from("part_orders")
      .update({
        ...(newDate && newDate !== oldDate ? { promised_date: newDate } : {}),
        ...(newDate !== oldDate ? { delay_notified_at: new Date().toISOString() } : {}),
      })
      .eq("id", order.id);

    report.push(
      `${String(order.id).slice(0, 8)} ${order.customer_name}: ${changed.map((c) => c.part_name).join(", ")} — ` +
        `${oldDate} → ${newDate ?? "undated"}${order.customer_email ? (sent ? " (emailed)" : " (EMAIL FAILED)") : " (no email — contact on WhatsApp)"}`
    );
  }

  if (report.length) {
    await sendEmail({
      to: [OWNER_EMAIL],
      subject: `Delivery dates: ${report.length} order(s) affected by lead-time changes`,
      html: `<ul>${report.map((r) => `<li>${r.replace(/</g, "&lt;")}</li>`).join("")}</ul>`,
    });
  }
  return Response.json({ checked: orders?.length ?? 0, affected: report });
}
