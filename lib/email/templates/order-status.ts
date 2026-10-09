// Emails: a store order changed status (0053 trigger part_orders_notify_status
// → kinds order_confirmed / order_paid / order_sourcing / order_shipped /
// order_delivered / order_cancelled). Transactional: no unsubscribe link, no
// credits block. The delivered email carries the one-tap rating row.
// payload: { ref, order_id, order_short, status, note, total_qar, payment_method } — all optional.

import { buildEmail, num, qar, str, type NotificationLocale, type RenderArgs, type Rendered } from "./layout";

export const ORDER_EMAIL_STATUSES = ["confirmed", "paid", "sourcing", "shipped", "delivered", "cancelled"] as const;
export type OrderEmailStatus = (typeof ORDER_EMAIL_STATUSES)[number];

type Copy = { subject: (o: string) => string; headline: (o: string) => string; body: string };

const COPY: Record<NotificationLocale, Record<OrderEmailStatus, Copy>> = {
  en: {
    confirmed: {
      subject: (o) => (o ? `Order #${o} confirmed` : "Your order is confirmed"),
      headline: (o) => (o ? `We have confirmed your order #${o}.` : "We have confirmed your order."),
      body: "We will message you on WhatsApp if anything needs your answer. You can follow every step on your order page.",
    },
    paid: {
      subject: (o) => (o ? `Payment received for order #${o}` : "Payment received"),
      headline: (o) => (o ? `Thank you — we have received your payment for order #${o}.` : "Thank you — we have received your payment."),
      body: "Next, we get your parts ready.",
    },
    sourcing: {
      subject: (o) => (o ? `We are preparing order #${o}` : "We are preparing your order"),
      headline: (o) => (o ? `We are getting the parts for order #${o} ready.` : "We are getting the parts for your order ready."),
      body: "We will email you again when it ships.",
    },
    shipped: {
      subject: (o) => (o ? `Order #${o} is on its way` : "Your order is on its way"),
      headline: (o) => (o ? `Your order #${o} is on its way.` : "Your order is on its way."),
      body: "We will message you on WhatsApp before delivery.",
    },
    delivered: {
      subject: (o) => (o ? `Order #${o} delivered` : "Your order was delivered"),
      headline: (o) => (o ? `Your order #${o} has been delivered.` : "Your order has been delivered."),
      body: "Thank you for ordering from Gestaltung360.",
    },
    cancelled: {
      subject: (o) => (o ? `Order #${o} cancelled` : "Your order was cancelled"),
      headline: (o) => (o ? `Your order #${o} has been cancelled.` : "Your order has been cancelled."),
      body: "If you did not ask for this, or you have a question, message us on WhatsApp.",
    },
  },
  ar: {
    confirmed: {
      subject: (o) => (o ? `تأكيد طلبك رقم ${o}` : "تأكيد طلبك"),
      headline: (o) => (o ? `أكّدنا طلبك رقم ${o}.` : "أكّدنا طلبك."),
      body: "سنراسلك على واتساب إذا احتاج أي شيء إلى ردّك. يمكنك متابعة كل خطوة في صفحة طلبك.",
    },
    paid: {
      subject: (o) => (o ? `استلمنا الدفع لطلبك رقم ${o}` : "استلمنا الدفع"),
      headline: (o) => (o ? `شكرًا لك — استلمنا دفعتك للطلب رقم ${o}.` : "شكرًا لك — استلمنا دفعتك."),
      body: "الخطوة التالية: نجهّز القطع.",
    },
    sourcing: {
      subject: (o) => (o ? `نجهّز طلبك رقم ${o}` : "نجهّز طلبك"),
      headline: (o) => (o ? `نجهّز قطع طلبك رقم ${o}.` : "نجهّز قطع طلبك."),
      body: "سنرسل لك رسالة أخرى عند شحنه.",
    },
    shipped: {
      subject: (o) => (o ? `طلبك رقم ${o} في الطريق إليك` : "طلبك في الطريق إليك"),
      headline: (o) => (o ? `طلبك رقم ${o} في الطريق إليك.` : "طلبك في الطريق إليك."),
      body: "سنراسلك على واتساب قبل التسليم.",
    },
    delivered: {
      subject: (o) => (o ? `تم تسليم طلبك رقم ${o}` : "تم تسليم طلبك"),
      headline: (o) => (o ? `تم تسليم طلبك رقم ${o}.` : "تم تسليم طلبك."),
      body: "شكرًا لطلبك من Gestaltung360.",
    },
    cancelled: {
      subject: (o) => (o ? `أُلغي طلبك رقم ${o}` : "أُلغي طلبك"),
      headline: (o) => (o ? `أُلغي طلبك رقم ${o}.` : "أُلغي طلبك."),
      body: "إذا لم تطلب الإلغاء أو لديك سؤال، راسلنا على واتساب.",
    },
  },
};

const LABELS = {
  en: {
    note: "Note from us",
    total: "Order total",
    cta: "View your order",
    rate: "How did we do? Tap a number (1 = poor, 5 = excellent).",
  },
  ar: {
    note: "ملاحظة منا",
    total: "إجمالي الطلب",
    cta: "اعرض طلبك",
    rate: "كيف كانت تجربتك؟ اختر رقمًا (1 = ضعيف، 5 = ممتاز).",
  },
} as const;

/** The renderer for one status. */
export function orderStatusRenderer(status: OrderEmailStatus) {
  return function render({ locale, payload, links }: RenderArgs): Rendered {
    const c = COPY[locale][status];
    const l = LABELS[locale];
    // Order references are ids: Latin letters and digits only, never more than 8.
    const order = str(payload.order_short).replace(/[^0-9a-z]/gi, "").slice(0, 8);
    const note = str(payload.note);
    const total = num(payload.total_qar, NaN);
    const showTotal = (status === "confirmed" || status === "paid") && Number.isFinite(total) && total > 0;
    const ordersUrl = links.orderUrl ?? `${links.siteUrl.replace(/\/+$/, "")}/${locale}/orders`;
    const scores = (links.ratingUrls ?? []).slice(0, 5);

    return buildEmail({
      locale,
      links,
      subject: c.subject(order),
      headline: c.headline(order),
      paragraphs: [c.body, ...(note ? [`${l.note}: ${note}`] : [])],
      facts: showTotal ? [{ label: l.total, value: qar(total, locale) }] : undefined,
      cta: { label: l.cta, url: ordersUrl },
      rating:
        status === "delivered" && scores.length === 5
          ? { question: l.rate, options: scores.map((url, i) => ({ label: String(i + 1), url })) }
          : undefined,
      howTo: false,
      orderEmail: true,
    });
  };
}
