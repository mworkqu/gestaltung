// Payment and enrollment emails (Prompt 10 Steps D, F). Bilingual: the
// student's language first, then the other one; one button; plain-text twin;
// built with the site's renderBrandedEmail() shell (same pattern as
// lib/cad-champions/questions/emails.ts). render* functions are PURE (tested);
// sendPaymentEmail is SERVER ONLY and never throws.
//
// IBAN rule: the IBAN appears ONLY in the "reservation" email (with the pay
// details), never on a public page.

import { OWNER_EMAIL, sendEmailResult } from "@/lib/email";
import { BRAND, escapeHtmlText, renderBrandedEmail, type BrandFact } from "@/lib/email/brand-layout";

type L = "en" | "ar";

export type PaymentEmailKind =
  | "reserved"
  | "proof_received"
  | "approved"
  | "rejected"
  | "expired"
  | "reminder_7d"
  | "reminder_1d";

export interface PaymentEmailData {
  locale: L;
  name: string | null;
  planName: { en: string; ar: string };
  /** Pre-formatted per language, e.g. { en: "QAR 1,250", ar: "1,250 ر.ق." } */
  amount: { en: string; ar: string };
  referenceCode: string;
  /** Absolute URL of the status page (or training / renewal for reminders). */
  url: string;
  /** Pre-formatted dates per language. */
  expiresAt?: { en: string; ar: string } | null;
  activeUntil?: { en: string; ar: string } | null;
  rejectReason?: { en: string; ar: string } | null;
  cohort?: { name: { en: string; ar: string }; dates: { en: string; ar: string } | null; location: { en: string; ar: string } | null } | null;
  /** reserved: our Fawran details (IBAN allowed here only). */
  fawran?: { alias: string; mobile: string | null; iban: string; accountName: string; bankName: string } | null;
  receiptUrl?: string | null;
  trainingUrl?: string | null;
  helpUrl?: string | null;
}

interface Copy {
  title: string;
  preheader: string;
  paragraphs: string[];
  button: string;
}

const hi = (l: L, n: string | null) => (l === "ar" ? (n ? `مرحبًا ${n}،` : "مرحبًا،") : n ? `Hi ${n},` : "Hi,");

function copyFor(kind: PaymentEmailKind, l: L, d: PaymentEmailData): Copy {
  const plan = d.planName[l];
  const amount = d.amount[l];
  const ar = l === "ar";
  switch (kind) {
    case "reserved":
      return ar
        ? {
            title: "تم حجز مكانك، أكمل الدفع",
            preheader: `حوّل ${amount} عبر فوري واكتب الرمز ${d.referenceCode} في الملاحظة.`,
            paragraphs: [
              hi(l, d.name),
              `اخترت خطة «${plan}». حوّل ${amount} عبر فوري من تطبيق بنكك، واكتب الرمز ${d.referenceCode} في ملاحظة التحويل حتى نطابق دفعتك.`,
              d.expiresAt ? `ينتهي هذا الحجز في ${d.expiresAt.ar}.` : "",
              "بعد التحويل، ارفع صورة التأكيد من صفحة الدفع.",
            ],
            button: "افتح صفحة الدفع",
          }
        : {
            title: "Your place is reserved: finish the payment",
            preheader: `Transfer ${amount} with Fawran and write ${d.referenceCode} in the note.`,
            paragraphs: [
              hi(l, d.name),
              `You chose "${plan}". Transfer ${amount} with Fawran from your bank app and write the code ${d.referenceCode} in the transfer note so we can match your payment.`,
              d.expiresAt ? `This reservation expires on ${d.expiresAt.en}.` : "",
              "After the transfer, upload the confirmation screenshot on the payment page.",
            ],
            button: "Open the payment page",
          };
    case "proof_received":
      return ar
        ? {
            title: "استلمنا إثبات التحويل",
            preheader: "نراجع تحويلك الآن، وسنرسل لك رسالة عند التأكيد.",
            paragraphs: [hi(l, d.name), `شكرًا! استلمنا إثبات تحويل ${amount} (الرمز ${d.referenceCode}). نراجعه الآن، وسنرسل لك رسالة عند التأكيد.`],
            button: "تابع حالة الدفع",
          }
        : {
            title: "We received your transfer proof",
            preheader: "We are checking your transfer and will email you when it is confirmed.",
            paragraphs: [hi(l, d.name), `Thanks! We received the proof for ${amount} (code ${d.referenceCode}). We are checking it now and will email you when it is confirmed.`],
            button: "See the payment status",
          };
    case "approved":
      return ar
        ? {
            title: "تم تأكيد الدفع، تدريبك مفعّل",
            preheader: `تدريبك في «${plan}» مفعّل الآن.`,
            paragraphs: [
              hi(l, d.name),
              `تم تأكيد دفعتك (${amount}). خطة «${plan}» مفعّلة الآن${d.activeUntil ? ` حتى ${d.activeUntil.ar}` : ""}.`,
              "ما الذي فُتح لك: كل الدروس، وسلّم التمارين لمسارك، والتلميحات وفيديوهات الحل، وأسئلة المدرّب.",
              "من أين تبدأ: افتح صفحة التدريب وابدأ بالمستوى الأول من الأساسيات.",
              d.cohort
                ? `دفعتك الحضورية: ${d.cohort.name.ar}${d.cohort.dates ? `، ${d.cohort.dates.ar}` : ""}${d.cohort.location ? `، ${d.cohort.location.ar}` : ""}.`
                : "",
              "تحتاج مساعدة؟ استخدم زر «تحتاج مساعدة؟» في أي صفحة، أو راسلنا على واتساب.",
            ],
            button: "ابدأ التدريب",
          }
        : {
            title: "Payment confirmed: your training is active",
            preheader: `Your "${plan}" training is now active.`,
            paragraphs: [
              hi(l, d.name),
              `Your payment (${amount}) is confirmed. "${plan}" is active now${d.activeUntil ? ` until ${d.activeUntil.en}` : ""}.`,
              "What is unlocked: every lesson, the exercise ladder for your track, hints and solution videos, and trainer questions.",
              "Where to start: open Training and begin with Foundations Level 1.",
              d.cohort
                ? `Your in-person cohort: ${d.cohort.name.en}${d.cohort.dates ? `, ${d.cohort.dates.en}` : ""}${d.cohort.location ? `, ${d.cohort.location.en}` : ""}.`
                : "",
              "Need help? Use the \"Need help?\" button on any page, or message us on WhatsApp.",
            ],
            button: "Start training",
          };
    case "rejected":
      return ar
        ? {
            title: "لم نستطع تأكيد تحويلك",
            preheader: "ارفع إثباتًا جديدًا من صفحة الدفع.",
            paragraphs: [
              hi(l, d.name),
              `لم نستطع تأكيد تحويل ${amount} (الرمز ${d.referenceCode}).`,
              d.rejectReason ? `السبب: ${d.rejectReason.ar}` : "",
              "ارفع إثباتًا جديدًا من صفحة الدفع، أو راسلنا على واتساب إن احتجت مساعدة.",
            ],
            button: "ارفع إثباتًا جديدًا",
          }
        : {
            title: "We could not confirm your transfer",
            preheader: "Upload a new proof from the payment page.",
            paragraphs: [
              hi(l, d.name),
              `We could not confirm the transfer of ${amount} (code ${d.referenceCode}).`,
              d.rejectReason ? `Reason: ${d.rejectReason.en}` : "",
              "Upload a new proof from the payment page, or message us on WhatsApp if you need help.",
            ],
            button: "Upload a new proof",
          };
    case "expired":
      return ar
        ? {
            title: "انتهى حجزك",
            preheader: "ابدأ من جديد متى أردت.",
            paragraphs: [hi(l, d.name), `انتهى حجز «${plan}» (الرمز ${d.referenceCode}) لأننا لم نستلم تحويلًا خلال 48 ساعة. إذا كان لك مقعد حضوري فقد أُعيد للآخرين.`, "ابدأ من جديد متى أردت؛ قد يتغير السعر والمقاعد."],
            button: "ابدأ من جديد",
          }
        : {
            title: "Your reservation expired",
            preheader: "Start again whenever you are ready.",
            paragraphs: [hi(l, d.name), `Your "${plan}" reservation (code ${d.referenceCode}) expired because we did not receive a transfer within 48 hours. Any in-person seat was released.`, "Start again whenever you are ready; the price and seats may have changed."],
            button: "Start again",
          };
    case "reminder_7d":
    case "reminder_1d": {
      const one = kind === "reminder_1d";
      return ar
        ? {
            title: one ? "ينتهي تدريبك غدًا" : "ينتهي تدريبك خلال 7 أيام",
            preheader: d.activeUntil ? `ينتهي وصولك في ${d.activeUntil.ar}.` : "جدّد لتستمر.",
            paragraphs: [hi(l, d.name), `ينتهي وصولك إلى «${plan}»${d.activeUntil ? ` في ${d.activeUntil.ar}` : ""}.`, "جدّد الآن لتستمر دون انقطاع؛ تبدأ المدة الجديدة عند انتهاء الحالية."],
            button: "جدّد التدريب",
          }
        : {
            title: one ? "Your training ends tomorrow" : "Your training ends in 7 days",
            preheader: d.activeUntil ? `Your access ends on ${d.activeUntil.en}.` : "Renew to keep going.",
            paragraphs: [hi(l, d.name), `Your access to "${plan}" ends${d.activeUntil ? ` on ${d.activeUntil.en}` : " soon"}.`, "Renew now to keep going without a break; the new period starts when the current one ends."],
            button: "Renew training",
          };
    }
  }
}

function factsFor(kind: PaymentEmailKind, l: L, d: PaymentEmailData): BrandFact[] {
  const ar = l === "ar";
  const facts: BrandFact[] = [];
  if (kind === "reminder_7d" || kind === "reminder_1d") return facts;
  facts.push({ label: ar ? "المبلغ" : "Amount", value: d.amount[l], ltr: true });
  facts.push({ label: ar ? "الرمز" : "Reference code", value: d.referenceCode, ltr: true });
  if (kind === "reserved" && d.fawran) {
    facts.push({ label: ar ? "اسم فوري المستعار" : "Fawran alias", value: d.fawran.alias, ltr: true });
    if (d.fawran.mobile) facts.push({ label: ar ? "رقم الجوال" : "Mobile", value: d.fawran.mobile, ltr: true });
    facts.push({ label: "IBAN", value: d.fawran.iban, ltr: true });
    facts.push({ label: ar ? "اسم الحساب" : "Account name", value: d.fawran.accountName, ltr: true });
    facts.push({ label: ar ? "البنك" : "Bank", value: d.fawran.bankName, ltr: true });
  }
  if (kind === "approved" && d.receiptUrl) {
    facts.push({ label: ar ? "الإيصال" : "Receipt", value: ar ? "تنزيل الإيصال" : "Download the receipt", href: d.receiptUrl });
  }
  return facts;
}

function otherBlock(kind: PaymentEmailKind, l: L, d: PaymentEmailData): { html: string; text: string } {
  const c = copyFor(kind, l, d);
  const dir = l === "ar" ? "rtl" : "ltr";
  const align = l === "ar" ? "right" : "left";
  const paras = [c.title, ...c.paragraphs.filter(Boolean)];
  const html = `<div dir="${dir}" lang="${l}" style="margin:18px 0 6px;padding:14px 0 0;border-top:1px solid ${BRAND.border};text-align:${align};font-family:Arial,Helvetica,sans-serif">${paras
    .map((p, i) => `<p style="margin:0 0 12px;font-size:${i === 0 ? 17 : 15}px;line-height:1.6;color:${i === 0 ? BRAND.ink : BRAND.body};${i === 0 ? "font-weight:bold;" : ""}">${escapeHtmlText(p)}</p>`)
    .join("")}</div>`;
  return { html, text: paras.join("\n\n") };
}

const REASON = {
  en: "You get this email because you are signing up for CAD Champions training.",
  ar: "وصلتك هذه الرسالة لأنك تسجّل في تدريب CAD Champions.",
} as const;

export function renderPaymentEmail(kind: PaymentEmailKind, d: PaymentEmailData): { subject: string; html: string; text: string } {
  const main = copyFor(kind, d.locale, d);
  const other: L = d.locale === "ar" ? "en" : "ar";
  const otherCopy = copyFor(kind, other, d);
  const second = otherBlock(kind, other, d);
  const { html, text } = renderBrandedEmail({
    locale: d.locale,
    title: main.title,
    preheader: main.preheader,
    paragraphs: main.paragraphs.filter(Boolean),
    facts: factsFor(kind, d.locale, d),
    bodyHtml: second.html,
    bodyText: second.text,
    buttons: [{ label: `${main.button} · ${otherCopy.button}`, url: d.url }],
    footer: { reason: `${REASON[d.locale]} · ${REASON[other]}` },
  });
  return { subject: `${main.title} · ${otherCopy.title}`, html, text };
}

/** Sends one payment email. Returns false (never throws) when it could not be sent. */
export async function sendPaymentEmail(to: string | null | undefined, kind: PaymentEmailKind, d: PaymentEmailData, idempotencyKey: string): Promise<boolean> {
  if (!to) return false;
  try {
    const mail = renderPaymentEmail(kind, d);
    const sent = await sendEmailResult({ to: [to], ...mail, idempotencyKey });
    if (!sent.ok) console.error("[cc-payments] email failed:", kind, sent.error);
    return sent.ok;
  } catch (e) {
    console.error("[cc-payments] email failed:", kind, e instanceof Error ? e.message : "unknown");
    return false;
  }
}

/** Short English alert to the owner when a proof arrives (admin queue link). */
export function renderOwnerProofAlert(input: { studentName: string | null; amount: string; referenceCode: string; bank: string | null; adminUrl: string }): { subject: string; html: string; text: string } {
  const { html, text } = renderBrandedEmail({
    locale: "en",
    title: "New CAD Champions payment proof",
    preheader: `${input.amount} · ${input.referenceCode}`,
    paragraphs: ["A student uploaded a Fawran transfer proof. Check your bank app, then approve or reject it."],
    facts: [
      { label: "Student", value: input.studentName ?? "-" },
      { label: "Amount", value: input.amount, ltr: true },
      { label: "Reference code", value: input.referenceCode, ltr: true },
      { label: "Bank", value: input.bank ?? "-" },
    ],
    buttons: [{ label: "Open the payments queue", url: input.adminUrl }],
    footer: { help: false },
  });
  return { subject: `CAD Champions payment proof: ${input.referenceCode}`, html, text };
}

export async function sendOwnerProofAlert(input: Parameters<typeof renderOwnerProofAlert>[0], idempotencyKey: string): Promise<boolean> {
  try {
    const mail = renderOwnerProofAlert(input);
    const sent = await sendEmailResult({ to: [process.env.CC_PAYMENTS_ALERT_EMAIL || OWNER_EMAIL], ...mail, idempotencyKey });
    if (!sent.ok) console.error("[cc-payments] owner alert failed:", sent.error);
    return sent.ok;
  } catch {
    return false;
  }
}
