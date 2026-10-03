// Email: a store order was marked delivered, so it earned credits (0042 trigger:
// +3 circuit (wiring) credits and +1 CAD credit per delivered order).
// payload: { ref, order_short, circuit_credits, cad_credits } — all optional.

import { buildEmail, creditCount, num, str, type RenderArgs, type Rendered } from "./layout";

export function render({ locale, payload, links }: RenderArgs): Rendered {
  const order = str(payload.order_short);
  let circuit = Math.max(0, Math.round(num(payload.circuit_credits, 3)));
  let cad = Math.max(0, Math.round(num(payload.cad_credits, 1)));
  if (circuit + cad === 0) {
    circuit = 3;
    cad = 1;
  }

  if (locale === "ar") {
    const earned = [
      circuit > 0 ? creditCount(circuit, "circuit", "ar", "acc") : "",
      cad > 0 ? creditCount(cad, "cad", "ar", "acc") : "",
    ]
      .filter(Boolean)
      .join(" و");
    return buildEmail({
      locale,
      links,
      subject: order ? `طلبك رقم ${order} منحك أرصدة` : "طلبك منحك أرصدة",
      headline: order ? `تهانينا — طلبك رقم ${order} منحك ${earned}.` : `تهانينا — طلبك منحك ${earned}.`,
      paragraphs: ["شكرًا لطلبك من Gestaltung360. أُضيفت الأرصدة إلى حسابك ويمكنك استخدامها الآن."],
      cta: { label: "افتح مشاريعي", url: links.projectsUrl },
    });
  }

  const earned = [
    circuit > 0 ? creditCount(circuit, "circuit", "en") : "",
    cad > 0 ? creditCount(cad, "cad", "en") : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return buildEmail({
    locale,
    links,
    subject: order ? `Your order #${order} earned you credits` : "Your order earned you credits",
    headline: order
      ? `Congratulations — your order #${order} earned you ${earned}.`
      : `Congratulations — your order earned you ${earned}.`,
    paragraphs: ["Thank you for ordering from Gestaltung360. The credits have been added to your account and you can use them now."],
    cta: { label: "Open my projects", url: links.projectsUrl },
  });
}
