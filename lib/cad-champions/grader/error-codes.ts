// Grader error codes -> student-facing messages (pure; EN + AR) and the Help
// Center article that explains the fix. The grader (Prompt 6) returns one of
// these codes; the upload UI calls graderErrorInfo(code, locale).
// Plain words: what happened, then what to do.

import type { Locale } from "@/i18n/routing";

export const GRADER_ERROR_CODES = [
  "E_NOT_STEP",
  "E_EMPTY",
  "E_PARSE_FAILED",
  "E_MULTIPLE_SOLIDS",
  "E_NO_SOLID",
  "E_WRONG_UNITS",
  "E_INVALID_GEOMETRY",
  "E_TOO_LARGE",
  "E_TIMEOUT",
] as const;

export type GraderErrorCode = (typeof GRADER_ERROR_CODES)[number];

export interface GraderErrorInfo {
  code: string;
  message: string;
  helpSlug: string;
}

const REJECTED = "my-file-was-rejected";

const INFO: Record<GraderErrorCode, { helpSlug: string; en: string; ar: string }> = {
  E_NOT_STEP: {
    helpSlug: REJECTED,
    en: "This file is not a STEP file. Export your model again as STEP (AP214 or AP242) and make sure the file name ends in .step or .stp.",
    ar: "هذا الملف ليس ملف STEP. صدّر نموذجك مرة أخرى بصيغة STEP (AP214 أو AP242) وتأكد أن اسم الملف ينتهي بـ .step أو .stp.",
  },
  E_EMPTY: {
    helpSlug: REJECTED,
    en: "The file is empty, so there is nothing to grade. Export your model again and check that the file is not 0 KB before you upload.",
    ar: "الملف فارغ، فلا يوجد شيء لنقيّمه. صدّر نموذجك مرة أخرى وتأكد أن حجم الملف ليس 0 KB قبل الرفع.",
  },
  E_PARSE_FAILED: {
    helpSlug: REJECTED,
    en: "We could not read this file. It may be damaged or cut short. Export it again as STEP and upload the new file.",
    ar: "لم نتمكن من قراءة هذا الملف. ربما هو تالف أو لم يكتمل تصديره. صدّره مرة أخرى بصيغة STEP وارفع الملف الجديد.",
  },
  E_MULTIPLE_SOLIDS: {
    helpSlug: REJECTED,
    en: "Your file has more than one separate solid, but this task needs exactly one. Combine your bodies into a single solid (for example with a Join or Combine command), then export again.",
    ar: "ملفك يحتوي على أكثر من جسم صلب منفصل، لكن هذه المهمة تحتاج جسمًا واحدًا فقط. ادمج الأجسام في جسم صلب واحد (مثلًا بأمر Join أو Combine) ثم صدّر مرة أخرى.",
  },
  E_NO_SOLID: {
    helpSlug: REJECTED,
    en: "We found no solid body in your file. It may contain only sketches or surfaces. Turn your design into a solid body, combine bodies if you have several, and export again.",
    ar: "لم نجد أي جسم صلب في ملفك. ربما يحتوي على رسومات أو أسطح فقط. حوّل تصميمك إلى جسم صلب، وادمج الأجسام إن كانت عدة، ثم صدّر مرة أخرى.",
  },
  E_WRONG_UNITS: {
    helpSlug: "set-units-to-mm",
    en: "Your model looks about 1000 times too big or too small. Set units to millimetres and export again.",
    ar: "يبدو نموذجك أكبر أو أصغر بحوالي 1000 مرة من المطلوب. اضبط الوحدات على المليمتر ثم صدّر مرة أخرى.",
  },
  E_INVALID_GEOMETRY: {
    helpSlug: REJECTED,
    en: "The shape in your file has a geometry problem (for example faces that do not close properly). Check your model for errors, fix them, and export again.",
    ar: "في شكل نموذجك مشكلة هندسية (مثلًا أسطح لا تُغلق بشكل صحيح). افحص نموذجك وأصلح الأخطاء ثم صدّر مرة أخرى.",
  },
  E_TOO_LARGE: {
    helpSlug: "my-file-is-too-large",
    en: "This file is too large to upload. Remove anything the task does not ask for, export only the required part, and try again.",
    ar: "حجم هذا الملف كبير جدًا للرفع. احذف كل ما لا تطلبه المهمة، وصدّر الجزء المطلوب فقط، ثم حاول مرة أخرى.",
  },
  E_TIMEOUT: {
    helpSlug: REJECTED,
    en: "Checking your file took too long, so we stopped. Try again in a minute. If it keeps happening, simplify the model and export again.",
    ar: "استغرق فحص ملفك وقتًا طويلًا فتوقفنا. حاول مرة أخرى بعد دقيقة. وإن تكرر ذلك، بسّط النموذج وصدّره مرة أخرى.",
  },
};

const GENERIC = {
  en: "We could not accept this file. Check that it is a STEP file of the right part, then try again.",
  ar: "لم نتمكن من قبول هذا الملف. تأكد أنه ملف STEP للقطعة الصحيحة ثم حاول مرة أخرى.",
};

export function isGraderErrorCode(code: unknown): code is GraderErrorCode {
  return typeof code === "string" && (GRADER_ERROR_CODES as readonly string[]).includes(code);
}

export function graderErrorInfo(code: string, locale: Locale): GraderErrorInfo {
  const l = locale === "ar" ? "ar" : "en";
  if (!isGraderErrorCode(code)) return { code, message: GENERIC[l], helpSlug: REJECTED };
  const e = INFO[code];
  return { code, message: e[l], helpSlug: e.helpSlug };
}
