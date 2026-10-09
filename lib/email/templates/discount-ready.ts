// Email: QAR 20 (or more) off the next order from credits the user spent
// (redeem_credits at checkout applies it, capped at the goods subtotal).
// payload: { ref, amount_qar, valid_until, earned_at }. The window is dated
// from the day the credit was EARNED (0053); discountWindow() in
// lib/notifications/decide.ts reads it (valid_until, else earned_at + 30 days)
// — the same function the drainer uses to skip an expired one.

import { REDEEM_DAYS } from "@/lib/credits/constants";
import { discountWindow } from "@/lib/notifications/decide";
import { buildEmail, formatDate, num, qar, type RenderArgs, type Rendered } from "./layout";

export function render({ locale, payload, links }: RenderArgs): Rendered {
  const amountRaw = num(payload.amount_qar, 20);
  const money = qar(amountRaw > 0 ? amountRaw : 20, locale);
  const window = discountWindow(payload);
  const until = formatDate(window.validUntil, locale);
  const earned = formatDate(window.earnedAt, locale);

  if (locale === "ar") {
    return buildEmail({
      locale,
      links,
      subject: `خصم ${money} على طلبك القادم`,
      headline: until ? `لديك خصم ${money} على طلبك القادم، صالح حتى ${until}.` : `لديك خصم ${money} على طلبك القادم.`,
      paragraphs: [
        "الخصم يأتي من الأرصدة التي استخدمتها. يظهر عند إتمام الطلب في المتجر ويُطبَّق حتى قيمة القطع في طلبك (دون الشحن).",
        ...(earned ? [`يُحسب الخصم لمدة ${REDEEM_DAYS} يومًا من يوم حصولك على الرصيد (${earned}).`] : []),
      ],
      cta: { label: "تسوّق من المتجر", url: links.storeUrl },
    });
  }
  return buildEmail({
    locale,
    links,
    subject: `${money} off your next order`,
    headline: until ? `You have ${money} off your next order, valid until ${until}.` : `You have ${money} off your next order.`,
    paragraphs: [
      "The discount comes from the credits you used. It shows at checkout in the store and is applied up to the value of the goods in your order (shipping excluded).",
      ...(earned ? [`It lasts ${REDEEM_DAYS} days from the day you earned the credit (${earned}).`] : []),
    ],
    cta: { label: "Shop in the store", url: links.storeUrl },
  });
}
