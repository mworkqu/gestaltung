// Email: the user's first drawn circuit. payload: { ref, project_id,
// project_name, circuit_balance?, cad_balance? }. The first circuit on each
// project is free (0042); further ones cost 1 circuit (wiring) credit.

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
      headline: "دائرتك الأولى جاهزة. الدوائر التالية تستخدم الأرصدة.",
      paragraphs: [
        `${name ? `دائرة مشروعك «${name}» كانت مجانية` : "دائرتك هذه كانت مجانية"}، فأول دائرة في كل مشروع مجانية. كل رسم إضافي للدائرة في المشروع يكلّف رصيد توصيل واحدًا.`,
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
    headline: "Your first circuit is ready. Your next ones use credits.",
    paragraphs: [
      `${name ? `The circuit for “${name}” was free` : "This circuit was free"}: your first circuit on each project is. Each further circuit drawing on a project costs 1 circuit credit.`,
      noCircuit
        ? "You have no circuit credits right now. Every completed store order adds 3 circuit credits and 1 CAD credit, and you can also top up on WhatsApp (QAR 20 per credit)."
        : "You get more credits with every completed store order (3 circuit credits and 1 CAD credit), or by topping up on WhatsApp (QAR 20 per credit).",
    ],
    facts: facts.length ? facts : undefined,
    cta: { label: hasProject ? "Open my project" : "Open my projects", url },
  });
}
