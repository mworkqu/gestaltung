// Email: the user's first drawn circuit. payload: { ref, project_id,
// project_name, circuit_balance?, cad_balance? }. Every circuit costs 1
// circuit (wiring) credit, the first one too (owner, 2026-10-09, 0052); the
// parts list is the only free step. Sent once per user, after the first
// circuit is drawn (0046 trigger on projects.free_wiring_used).

import { buildEmail, optNum, str, type RenderArgs, type Rendered } from "./layout";

export function render({ locale, payload, links }: RenderArgs): Rendered {
  const name = str(payload.project_name);
  const circuit = optNum(payload.circuit_balance);
  const cad = optNum(payload.cad_balance);
  const url = links.projectUrl ?? links.projectsUrl;
  const hasProject = !!links.projectUrl;
  const noCircuit = circuit !== undefined && circuit <= 0;

  if (locale === "ar") {
    const facts = [
      ...(circuit !== undefined ? [{ label: "أرصدة التوصيل", value: String(circuit) }] : []),
      ...(cad !== undefined ? [{ label: "أرصدة CAD", value: String(cad) }] : []),
    ];
    return buildEmail({
      locale,
      links,
      subject: "دائرتك الأولى جاهزة",
      headline: "دائرتك الأولى جاهزة.",
      paragraphs: [
        `${name ? `رُسمت دائرة مشروعك «${name}»` : "رُسمت دائرتك"} باستخدام رصيد توصيل واحد. كل رسم للدائرة يكلّف رصيد توصيل واحدًا، وقائمة القطع مجانية.`,
        noCircuit
          ? "ليس لديك أرصدة توصيل حاليًا. كل طلب مكتمل من المتجر يضيف 3 أرصدة توصيل ورصيد CAD واحدًا، ويمكنك أيضًا شحن رصيدك عبر واتساب (20 ر.ق للرصيد الواحد)."
          : "تحصل على المزيد من الأرصدة مع كل طلب مكتمل من المتجر (3 أرصدة توصيل ورصيد CAD واحد)، أو بالشحن عبر واتساب (20 ر.ق للرصيد الواحد).",
      ],
      facts: facts.length ? facts : undefined,
      cta: { label: hasProject ? "افتح مشروعي" : "افتح مشاريعي", url },
    });
  }

  const facts = [
    ...(circuit !== undefined ? [{ label: "Circuit credits", value: String(circuit) }] : []),
    ...(cad !== undefined ? [{ label: "CAD credits", value: String(cad) }] : []),
  ];
  return buildEmail({
    locale,
    links,
    subject: "Your first circuit is ready",
    headline: "Your first circuit is ready.",
    paragraphs: [
      `${name ? `The circuit for “${name}” is drawn` : "Your circuit is drawn"} and used 1 circuit credit. Each circuit drawing costs 1 circuit credit; the parts list is free.`,
      noCircuit
        ? "You have no circuit credits right now. Every completed store order adds 3 circuit credits and 1 CAD credit, and you can also top up on WhatsApp (QAR 20 per credit)."
        : "You get more credits with every completed store order (3 circuit credits and 1 CAD credit), or by topping up on WhatsApp (QAR 20 per credit).",
    ],
    facts: facts.length ? facts : undefined,
    cta: { label: hasProject ? "Open my project" : "Open my projects", url },
  });
}
