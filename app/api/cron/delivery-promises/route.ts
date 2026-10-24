import { createServiceClient } from "@/lib/supabase/service";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import { dateChangeEmail, type OrderForEmail } from "@/lib/store/order-email";
import {
  orderUpdateFor,
  planPromiseReview,
  reportLine,
  type CronShippingConfig,
  type PromiseItemRow,
  type PromiseOrder,
} from "@/lib/store/delivery-promises";
import { OPEN_ORDER_STATUSES } from "@/lib/orders/status";
import { HOLIDAYS_KEY, parseHolidays } from "@/lib/store/working-days";
import { jsonError, jsonOk } from "@/lib/http";

// Daily (vercel.json cron): for every open order whose promised date hasn't
// passed, compare each item's lead-time class now with the one it was sold
// at. If any changed, recompute the date the same way checkout did (supplier
// lead in calendar days, then handling + transit + buffer in Qatar working
// days, lib/store/working-days.ts — mirrors order_delivery_quote v3) and email
// the customer — BEFORE the promised date, never after:
//   later date   → "new date is …" and the order's promise moves;
//   same/earlier → "your date still holds";
//   no offer now → "we can't date it yet, we'll contact you".
// Lines sold "on request" (no lead-time class, 0032) never had a date and are
// skipped; an order with only such lines has no promised date and isn't
// selected at all. Item snapshots are updated so each change is emailed once.
// The owner gets a summary of what was sent.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Not yet shipped: the 0053 set (confirmed, paid, sourcing) and the old one (pending, processing).
const OPEN = OPEN_ORDER_STATUSES.filter((s) => s !== "shipped");

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const db = createServiceClient();
  if (!db) return jsonError("no_service_key", 500);

  const today = new Date().toISOString().slice(0, 10);
  const { data: cfgRow } = await db.from("store_settings").select("value").eq("key", "shipping").maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as CronShippingConfig;
  // Qatar weekend + public holidays (0054), the same rule order_delivery_quote
  // uses; no row = calendar days, as the database does before 0054.
  const { data: holidaysRow } = await db.from("store_settings").select("value").eq("key", HOLIDAYS_KEY).maybeSingle();
  const holidays = holidaysRow ? parseHolidays(holidaysRow.value) : null;

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
    const rows = (items ?? []) as unknown as PromiseItemRow[];
    const plan = planPromiseReview(order as PromiseOrder, rows, cfg, holidays);
    if (!plan) continue;
    const { changed, oldDate, newDate } = plan;

    let sent = false;
    if (order.customer_email) {
      const mail = dateChangeEmail(order as OrderForEmail, oldDate, newDate, changed.map((c) => c.part_name), {
        workingDays: Boolean(holidays),
      });
      sent = await sendEmail({ to: [order.customer_email], ...mail });
    }

    for (const u of plan.itemUpdates) {
      await db.from("part_order_items").update({ lead_time_class: u.lead_time_class }).eq("id", u.id);
    }
    await db.from("part_orders").update(orderUpdateFor(plan, new Date())).eq("id", order.id);

    report.push(reportLine(order, plan, order.customer_email ? (sent ? "sent" : "failed") : "no_address"));
  }

  if (report.length) {
    await sendEmail({
      to: [OWNER_EMAIL],
      subject: `Delivery dates: ${report.length} order(s) affected by lead-time changes`,
      ...renderOwnerEmail({
        title: "Delivery dates affected by lead-time changes",
        paragraphs: report,
      }),
    });
  }
  return jsonOk({ checked: orders?.length ?? 0, affected: report });
}
