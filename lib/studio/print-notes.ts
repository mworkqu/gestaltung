// What the Print step says about the files it can and cannot hand over (F-003,
// F-042). EN + AR inline, like lib/studio/plain-checks.ts and the library part
// names: one short sentence for a non-engineer, no jargon, no mesh talk.
//
// These belong in messages/{en,ar}.json once that file is free to edit; the
// keys to move them to are listed in the stage report.

import type { Locale } from "./netlist-parts";

export type PrintNote = { en: string; ar: string };

export const PRINT_NOTES = {
  /** One or more bodies failed the manifold check, so their STL is withheld. */
  unclosed: {
    en: "We could not close this model, so we are not giving you a file for it. Ask us for a quote and an engineer will finish it.",
    ar: "لم نتمكن من إغلاق هذا المجسم، لذلك لا نعطيك ملفاً له. اطلب عرض سعر وسيكمله أحد المهندسين.",
  },
  /** The named parts are withheld (listed after this line). */
  unclosedParts: { en: "Not ready as a file:", ar: "غير جاهز كملف:" },
  /** A body is larger than the printer bed. */
  tooBig: {
    en: "This part is bigger than our printer bed, so it is not on a plate. An engineer will split it for you.",
    ar: "هذه القطعة أكبر من سطح طباعتنا، لذلك ليست على لوح. سيقسمها أحد المهندسين لك.",
  },
  /** More than one bed is needed. */
  plates: { en: "Your parts need {n} printer plates.", ar: "تحتاج قطعك إلى {n} ألواح طباعة." },
  /** F-042: STL is what the Print step gives; STEP comes with the engineer quote. */
  stepFormat: {
    en: "These files are STL, for printing. A STEP file you can edit comes with the engineer quote.",
    ar: "هذه الملفات بصيغة STL للطباعة. ملف STEP القابل للتعديل يأتي مع عرض سعر المهندس.",
  },
} as const satisfies Record<string, PrintNote>;

export type PrintNoteKey = keyof typeof PRINT_NOTES;

/** The note in the page's language, with {n} filled in. */
export function printNote(key: PrintNoteKey, locale: Locale, vars: Record<string, string | number> = {}): string {
  const text = PRINT_NOTES[key][locale === "ar" ? "ar" : "en"];
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
