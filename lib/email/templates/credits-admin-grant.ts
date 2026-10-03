// Email: the owner added credits to the account by hand (top-up or correction,
// dashboard > AI credits). payload: { ref, amount, credit_kind, note }.
// credit_kind is "wiring" | "cad" (the ledger kinds); "circuit" is accepted too.

import { buildEmail, creditCount, num, str, type CreditWord, type RenderArgs, type Rendered } from "./layout";

function wordOf(kind: unknown): CreditWord {
  const k = str(kind).toLowerCase();
  if (k === "cad") return "cad";
  if (k === "wiring" || k === "circuit") return "circuit";
  return "any";
}

export function render({ locale, payload, links }: RenderArgs): Rendered {
  const amount = Math.round(num(payload.amount, 0));
  const n = Math.abs(amount);
  const word = wordOf(payload.credit_kind);
  const note = str(payload.note);
  const negative = amount < 0;

  if (locale === "ar") {
    const count = creditCount(n, word, "ar", "gen");
    return buildEmail({
      locale,
      links,
      subject: negative ? "تم تعديل رصيدك" : `حصلت على ${count}`,
      headline: negative
        ? `جرى تعديل رصيدك بمقدار ${count}${note ? `: ${note}` : "."}`
        : `حصلت على ${count}${note ? `: ${note}` : "."}`,
      paragraphs: [
        negative
          ? "تم تعديل رصيدك في Gestaltung360 يدويًا. إن كان لديك سؤال عن هذا التعديل فراسلنا على واتساب."
          : "أُضيفت الأرصدة إلى حسابك في Gestaltung360 ويمكنك استخدامها الآن.",
      ],
      cta: { label: "افتح مشاريعي", url: links.projectsUrl },
    });
  }

  const count = creditCount(n, word, "en");
  return buildEmail({
    locale,
    links,
    subject: negative ? "Your credit balance was adjusted" : `You received ${count}`,
    headline: negative
      ? `Your balance was adjusted by ${count}${note ? `: ${note}` : "."}`
      : `You received ${count}${note ? `: ${note}` : "."}`,
    paragraphs: [
      negative
        ? "Your balance on Gestaltung360 was adjusted by hand. If you have a question about it, message us on WhatsApp."
        : "The credits have been added to your Gestaltung360 account and you can use them now.",
    ],
    cta: { label: "Open my projects", url: links.projectsUrl },
  });
}
