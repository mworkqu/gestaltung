// Server-only: order emails (Task 18d/f) — the confirmation with its promised
// date(s), and the notice sent BEFORE a promised date when it moves. Each is
// bilingual (English, then Arabic) because the cron that sends delay notices
// doesn't know the customer's language.

import { escapeHtml } from "@/lib/email";
import { formatDeliveryDate } from "@/lib/store/delivery";

type Item = { part_name: string; quantity: number; unit_price_qar: number; lead_time_class: string | null };
export type OrderForEmail = {
  id: string;
  customer_name: string;
  total_qar: number;
  shipping_tier: string | null;
  split_shipments: boolean;
  shipping_qar: number;
  handling_fee_qar: number;
  promised_date: string | null;
  early_promised_date: string | null;
  held_by: string | null;
};

const LEAD_EN: Record<string, string> = { in_stock: "In stock", "3_5_days": "3–5 days", "1_2_weeks": "1–2 weeks", "2_4_weeks": "2–4 weeks" };
const LEAD_AR: Record<string, string> = { in_stock: "متوفر", "3_5_days": "3–5 أيام", "1_2_weeks": "1–2 أسبوع", "2_4_weeks": "2–4 أسابيع" };
const TIER_EN: Record<string, string> = { express: "Express", standard: "Standard", economy: "Economy" };
const TIER_AR: Record<string, string> = { express: "سريع", standard: "عادي", economy: "اقتصادي" };

const qar = (n: number) => `QAR ${Number(n).toFixed(2)}`;
const e = escapeHtml;

function dates(o: OrderForEmail, locale: "en" | "ar") {
  const late = formatDeliveryDate(o.promised_date, locale);
  if (o.split_shipments && o.early_promised_date) {
    const early = formatDeliveryDate(o.early_promised_date, locale);
    return locale === "en"
      ? `First shipment arrives by <b>${early}</b>, the rest by <b>${late}</b>.`
      : `الشحنة الأولى تصل بحلول <b>${early}</b>، والباقي بحلول <b>${late}</b>.`;
  }
  const held = o.held_by
    ? locale === "en"
      ? ` (one shipment, timed by ${e(o.held_by)})`
      : ` (شحنة واحدة، موعدها يحدده ${e(o.held_by)})`
    : "";
  return locale === "en" ? `Arrives by <b>${late}</b>${held}.` : `يصل بحلول <b>${late}</b>${held}.`;
}

export function confirmationEmail(o: OrderForEmail, items: Item[]) {
  const ref = o.id.slice(0, 8);
  const rows = (lead: Record<string, string>) =>
    items
      .map(
        (i) =>
          `<tr><td>${e(i.part_name)} × ${i.quantity}</td><td>${e(lead[i.lead_time_class ?? ""] ?? "")}</td><td align="right">${qar(i.unit_price_qar * i.quantity)}</td></tr>`
      )
      .join("");
  const tierEn = TIER_EN[o.shipping_tier ?? ""] ?? "";
  const tierAr = TIER_AR[o.shipping_tier ?? ""] ?? "";
  const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Hi ${e(o.customer_name)},</p>
<p>Thanks for your order <b>${ref}</b>. ${dates(o, "en")}</p>
<table cellpadding="4" style="border-collapse:collapse">${rows(LEAD_EN)}
<tr><td>Shipping — ${tierEn}${o.split_shipments ? " × 2 shipments" : ""}</td><td></td><td align="right">${qar(o.shipping_qar)}</td></tr>
<tr><td>Handling fee</td><td></td><td align="right">${qar(o.handling_fee_qar)}</td></tr>
<tr><td><b>Total</b></td><td></td><td align="right"><b>${qar(o.total_qar)}</b></td></tr></table>
<p>If this date is going to change we will email you before it, not after. We'll confirm payment and delivery on WhatsApp.</p>
<hr/>
<div dir="rtl">
<p>مرحباً ${e(o.customer_name)}،</p>
<p>شكراً لطلبك <b>${ref}</b>. ${dates(o, "ar")}</p>
<table cellpadding="4" style="border-collapse:collapse">${rows(LEAD_AR)}
<tr><td>الشحن — ${tierAr}</td><td></td><td>${qar(o.shipping_qar)}</td></tr>
<tr><td>رسوم التجهيز</td><td></td><td>${qar(o.handling_fee_qar)}</td></tr>
<tr><td><b>الإجمالي</b></td><td></td><td><b>${qar(o.total_qar)}</b></td></tr></table>
<p>إذا تغيّر هذا الموعد فسنراسلك قبله، لا بعده. سنؤكد الدفع والتوصيل عبر واتساب.</p>
</div></div>`;
  return { subject: `Order ${ref} — arrives by ${formatDeliveryDate(o.promised_date, "en")} | طلبك ${ref}`, html };
}

/** newDate null = we can no longer date it (the supplier offer is gone). */
export function dateChangeEmail(o: OrderForEmail, oldDate: string, newDate: string | null, changed: string[]) {
  const ref = o.id.slice(0, 8);
  const list = changed.map((c) => e(c)).join(", ");
  const later = newDate === null || newDate > oldDate;
  const en = newDate === null
    ? `The lead time for ${list} has changed and we can't yet confirm a new date. We'll contact you on WhatsApp within one working day.`
    : later
      ? `The lead time for ${list} has changed. Your order was due by ${formatDeliveryDate(oldDate, "en")}; the new date is <b>${formatDeliveryDate(newDate, "en")}</b>. Reply to this email or message us on WhatsApp if you'd rather cancel or change the order.`
      : `The lead time for ${list} has changed. Your delivery date of <b>${formatDeliveryDate(oldDate, "en")}</b> still holds.`;
  const ar = newDate === null
    ? `تغيّرت مدة توريد ${list} ولا يمكننا بعد تأكيد موعد جديد. سنتواصل معك عبر واتساب خلال يوم عمل.`
    : later
      ? `تغيّرت مدة توريد ${list}. كان موعد طلبك ${formatDeliveryDate(oldDate, "ar")}؛ والموعد الجديد <b>${formatDeliveryDate(newDate, "ar")}</b>. راسلنا إن أردت إلغاء الطلب أو تعديله.`
      : `تغيّرت مدة توريد ${list}. موعد التوصيل <b>${formatDeliveryDate(oldDate, "ar")}</b> ما زال قائماً.`;
  return {
    subject: later ? `Order ${ref}: new delivery date | موعد جديد لطلبك` : `Order ${ref}: delivery date unchanged | موعد طلبك`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>Hi ${e(o.customer_name)},</p><p>${en}</p><hr/><div dir="rtl"><p>${ar}</p></div></div>`,
  };
}
