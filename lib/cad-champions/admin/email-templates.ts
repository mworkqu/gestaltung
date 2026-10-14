// Registry of every bilingual email the CAD Champions app sends, with sample
// data (Prompt 11 Step F). The admin Emails page renders each one (HTML in a
// sandboxed iframe + the plain-text twin) and can send a test to the admin.
// PURE: only the render functions of the real emails are called, so a preview
// is exactly what a student gets.
//
// Not listed (not rendered in code): the three Supabase auth emails (confirm
// sign-up, magic link, reset password). They live in
// supabase/auth-templates-cc/*.html and are pasted into the Supabase dashboard
// (docs/cad-champions/AUTH_EMAILS.md); see AUTH_TEMPLATE_FILES.

import { defaultSiteUrl } from "@/lib/email/brand-layout";

import { renderPaymentEmail, renderOwnerProofAlert, type PaymentEmailData, type PaymentEmailKind } from "../payments/emails";
import { renderAnswerEmail } from "../questions/emails";
import { ccPath } from "../routes";
import { renderFinalScoreEmail, renderResultsReadyEmail } from "../scoring/emails";
import { renderWeeklyProgressEmail } from "../training/weekly-email";
import { renderAnnouncementEmail } from "./announcements";

export type EmailGroup = "payments" | "questions" | "results" | "training" | "announcements" | "owner";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplateDef {
  id: string;
  group: EmailGroup;
  /** true: the student's language goes first, so EN-first and AR-first previews differ. */
  localeAware: boolean;
  /** Owner-facing (English only), not sent to students. */
  ownerOnly: boolean;
  /** true: one email carries Arabic and English; false: only the student's language (weekly progress). */
  bilingual: boolean;
  render(locale: "en" | "ar", siteUrl?: string): RenderedEmail;
}

export const AUTH_TEMPLATE_FILES = ["confirm-signup.html", "magic-link.html", "reset-password.html"] as const;

function paymentSample(locale: "en" | "ar", site: string): PaymentEmailData {
  return {
    locale,
    name: locale === "ar" ? "سارة" : "Sara",
    planName: { en: "Online training", ar: "التدريب عبر الإنترنت" },
    amount: { en: "QAR 1,250", ar: "1,250 ر.ق." },
    referenceCode: "CAD-7K3P",
    url: `${site}${ccPath(locale, "/account/payments")}`,
    expiresAt: { en: "16 Oct 2026, 10:00", ar: "16 أكتوبر 2026، 10:00" },
    activeUntil: { en: "14 Jan 2027", ar: "14 يناير 2027" },
    rejectReason: { en: "The amount does not match the transfer.", ar: "المبلغ لا يطابق التحويل." },
    cohort: {
      name: { en: "Spring cohort", ar: "دفعة الربيع" },
      dates: { en: "1 Mar to 30 Apr 2027", ar: "1 مارس إلى 30 أبريل 2027" },
      location: { en: "Lusail, Qatar", ar: "لوسيل، قطر" },
    },
    fawran: { alias: "SAMPLE-ALIAS", mobile: "+97455550000", iban: "QA00 SAMP 0000 0000 0000 0000 0000 0", accountName: "Sample account name", bankName: "Sample bank" },
    receiptUrl: `${site}${ccPath(locale, "/account/payments/receipt")}`,
    trainingUrl: `${site}${ccPath(locale, "/training")}`,
    helpUrl: `${site}${ccPath(locale, "/help")}`,
  };
}

const PAYMENT_KINDS: readonly PaymentEmailKind[] = ["reserved", "proof_received", "approved", "rejected", "expired", "reminder_7d", "reminder_1d"];

const results = (site: string) => ({
  name: "Sara",
  testTitleEn: "Diagnostic test",
  testTitleAr: "الاختبار التشخيصي",
  percent: 72.5,
  band: "competitive" as const,
  url: `${site}${ccPath("en", "/results")}`,
});

export function listEmailTemplates(): EmailTemplateDef[] {
  const defs: EmailTemplateDef[] = [];
  for (const kind of PAYMENT_KINDS) {
    defs.push({
      id: `payment_${kind}`,
      group: "payments",
      localeAware: true,
      ownerOnly: false,
      bilingual: true,
      render: (locale, siteUrl = defaultSiteUrl()) => renderPaymentEmail(kind, paymentSample(locale, siteUrl)),
    });
  }
  defs.push({
    id: "payment_owner_alert",
    group: "owner",
    localeAware: false,
    ownerOnly: true,
    bilingual: false,
    render: (_l, siteUrl = defaultSiteUrl()) =>
      renderOwnerProofAlert({ studentName: "Sara Student", amount: "QAR 1,250", referenceCode: "CAD-7K3P", bank: "Sample bank", adminUrl: `${siteUrl}${ccPath("en", "/admin/payments")}` }),
  });
  for (const kind of ["grade_query", "lesson"] as const) {
    defs.push({
      id: `answer_${kind}`,
      group: "questions",
      localeAware: true,
      ownerOnly: false,
      bilingual: true,
      render: (locale, siteUrl = defaultSiteUrl()) =>
        renderAnswerEmail({
          locale,
          name: locale === "ar" ? "سارة" : "Sara",
          kind,
          question: locale === "ar" ? "لماذا خُصمت درجة على البعد؟" : "Why did I lose marks on the dimension?",
          answer: locale === "ar" ? "البعد كان خارج التفاوت المسموح. راجع الخطوة 3 في الدرس." : "The dimension was outside the allowed tolerance. Review step 3 of the lesson.",
          url: `${siteUrl}${ccPath(locale, kind === "lesson" ? "/training" : "/results")}`,
        }),
    });
  }
  defs.push(
    {
      id: "results_ready",
      group: "results",
      localeAware: false,
      ownerOnly: false,
      bilingual: true,
      render: (_l, siteUrl = defaultSiteUrl()) => renderResultsReadyEmail({ ...results(siteUrl), provisional: true }),
    },
    {
      id: "results_final",
      group: "results",
      localeAware: false,
      ownerOnly: false,
      bilingual: true,
      render: (_l, siteUrl = defaultSiteUrl()) => renderFinalScoreEmail({ ...results(siteUrl), previousPercent: 70 }),
    },
    {
      id: "weekly_progress",
      group: "training",
      localeAware: true,
      ownerOnly: false,
      bilingual: false,
      render: (locale, siteUrl = defaultSiteUrl()) =>
        renderWeeklyProgressEmail({
          locale,
          name: locale === "ar" ? "سارة" : "Sara",
          lessonsDone: 3,
          exercisesPassed: 2,
          xp: 340,
          streak: 4,
          next: { title: locale === "ar" ? "الأساسيات، المستوى 2" : "Foundations, Level 2", url: `${siteUrl}${ccPath(locale, "/training")}` },
          trainingUrl: `${siteUrl}${ccPath(locale, "/training")}`,
          settingsUrl: `${siteUrl}${ccPath(locale, "/account")}`,
        }),
    },
    {
      id: "announcement",
      group: "announcements",
      localeAware: false,
      ownerOnly: false,
      bilingual: true,
      render: (_l, siteUrl = defaultSiteUrl()) =>
        renderAnnouncementEmail(
          {
            kind: "marketing",
            subjectEn: "New cohort opens in March",
            subjectAr: "تفتح دفعة جديدة في مارس",
            bodyEn: "Hello,\n\nA new in-person cohort opens in March.\n\n- Small groups\n- Trainer feedback\n\nSee [the details](" + siteUrl + ccPath("en", "/training/join") + ").",
            bodyAr: "مرحبًا،\n\nتفتح دفعة حضورية جديدة في مارس.\n\n- مجموعات صغيرة\n- ملاحظات من المدرّب\n\nاطّلع على [التفاصيل](" + siteUrl + ccPath("ar", "/training/join") + ").",
          },
          { siteUrl },
        ),
    },
  );
  return defs;
}

export function findEmailTemplate(id: string): EmailTemplateDef | null {
  return listEmailTemplates().find((t) => t.id === id) ?? null;
}
