// Result emails (Prompt 7 Step F) — "Your results are ready" and "Your final
// score is confirmed". Bilingual, Arabic first, one button, plain-text part,
// all through the site's renderBrandedEmail() shell.
//
// renderResultsReadyEmail / renderFinalScoreEmail are PURE (tested).
// sendResultsReadyEmail / sendFinalScoreEmail are SERVER ONLY: they claim
// cc_attempts.results_email_sent_at / final_email_sent_at (migration 0081)
// before sending, so each email goes out once; a failed send releases the
// claim. Before 0081 has run they send nothing (no way to stay idempotent).

import type { Locale } from "@/i18n/routing";
import { sendEmailResult } from "@/lib/email";
import { defaultSiteUrl, escapeHtmlText, renderBrandedEmail, BRAND } from "@/lib/email/brand-layout";
import { createServiceClient } from "@/lib/supabase/service";

import type { CcBand } from "../db/types";
import { ccPath } from "../routes";

export const BAND_LABEL: Record<CcBand, { en: string; ar: string }> = {
  beginner: { en: "Beginner", ar: "مبتدئ" },
  developing: { en: "Developing", ar: "في تطوّر" },
  competitive: { en: "Competitive", ar: "منافس" },
  competition_ready: { en: "Competition-ready", ar: "جاهز للمنافسة" },
};

export interface ResultsEmailData {
  name: string | null;
  testTitleEn: string;
  testTitleAr: string;
  percent: number;
  band: CcBand;
  provisional: boolean;
  /** Absolute URL of the results page. */
  url: string;
}

export interface FinalEmailData extends Omit<ResultsEmailData, "provisional"> {
  /** The percent shown in the first (provisional) email. */
  previousPercent: number;
}

function pct(n: number): string {
  // Western digits in both languages; at most one decimal.
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

function englishBlock(paragraphs: string[]): { html: string; text: string } {
  const html = `<div dir="ltr" lang="en" style="margin:18px 0 6px;padding:14px 0 0;border-top:1px solid ${BRAND.border};text-align:left;font-family:Arial,Helvetica,sans-serif">${paragraphs
    .map((p, i) => `<p style="margin:0 0 12px;font-size:${i === 0 ? 17 : 15}px;line-height:1.6;color:${i === 0 ? BRAND.ink : BRAND.body};${i === 0 ? "font-weight:bold;" : ""}">${escapeHtmlText(p)}</p>`)
    .join("")}</div>`;
  return { html, text: paragraphs.join("\n\n") };
}

export function renderResultsReadyEmail(d: ResultsEmailData): { subject: string; html: string; text: string } {
  const bandAr = BAND_LABEL[d.band].ar;
  const bandEn = BAND_LABEL[d.band].en;
  const hiAr = d.name ? `مرحبًا ${d.name}،` : "مرحبًا،";
  const hiEn = d.name ? `Hi ${d.name},` : "Hi,";
  const ar = [
    hiAr,
    `نتائج «${d.testTitleAr}» جاهزة. نتيجتك ${pct(d.percent)}، ومستواك: ${bandAr}.`,
    "في صفحة النتائج تجد خريطة مهاراتك، وملاحظات على كل مهمة، والخطوات التي ننصحك بها.",
    ...(d.provisional ? ["ما زال المدرّب يراجع رسمك، لذلك قد تتغير نتيجتك قليلًا. سنرسل لك رسالة عند تأكيدها."] : []),
  ];
  const en = englishBlock([
    "Your results are ready",
    hiEn,
    `Your results for "${d.testTitleEn}" are ready. You scored ${pct(d.percent)}: ${bandEn}.`,
    "Your results page shows your skill map, feedback on each task and the steps we recommend next.",
    ...(d.provisional ? ["A trainer still needs to confirm your drawing, so your score may change slightly. We'll email you when it is final."] : []),
  ]);
  const { html, text } = renderBrandedEmail({
    locale: "ar",
    title: "نتائجك جاهزة",
    preheader: `${pct(d.percent)} · ${bandAr} · ${bandEn}`,
    paragraphs: ar,
    bodyHtml: en.html,
    bodyText: en.text,
    buttons: [{ label: "عرض النتائج · View my results", url: d.url }],
    footer: { reason: "وصلتك هذه الرسالة لأنك أنهيت اختبارًا في CAD Champions. · You get this email because you finished a CAD Champions test." },
  });
  return { subject: `نتائجك جاهزة · Your results are ready (${pct(d.percent)})`, html, text };
}

export function renderFinalScoreEmail(d: FinalEmailData): { subject: string; html: string; text: string } {
  const bandAr = BAND_LABEL[d.band].ar;
  const bandEn = BAND_LABEL[d.band].en;
  const diff = Math.round((d.percent - d.previousPercent) * 10) / 10;
  const changed = Math.abs(diff) >= 0.1;
  const sign = diff > 0 ? "+" : "−";
  const delta = `${sign}${pct(Math.abs(diff))}`;
  const hiAr = d.name ? `مرحبًا ${d.name}،` : "مرحبًا،";
  const hiEn = d.name ? `Hi ${d.name},` : "Hi,";
  const ar = [
    hiAr,
    `راجع المدرّب عملك في «${d.testTitleAr}». نتيجتك النهائية ${pct(d.percent)}، ومستواك: ${bandAr}.`,
    changed
      ? `تغيّرت نتيجتك من ${pct(d.previousPercent)} إلى ${pct(d.percent)} (${delta}).`
      : "لم تتغير نتيجتك بعد المراجعة.",
  ];
  const en = englishBlock([
    "Your final score is confirmed",
    hiEn,
    `A trainer has reviewed your work for "${d.testTitleEn}". Your final score is ${pct(d.percent)}: ${bandEn}.`,
    changed ? `Your score changed from ${pct(d.previousPercent)} to ${pct(d.percent)} (${delta}).` : "Your score did not change after the review.",
  ]);
  const { html, text } = renderBrandedEmail({
    locale: "ar",
    title: "تم تأكيد نتيجتك النهائية",
    preheader: `${pct(d.percent)} · ${bandAr} · ${bandEn}`,
    paragraphs: ar,
    bodyHtml: en.html,
    bodyText: en.text,
    buttons: [{ label: "عرض النتائج · View my results", url: d.url }],
    footer: { reason: "وصلتك هذه الرسالة لأنك أنهيت اختبارًا في CAD Champions. · You get this email because you finished a CAD Champions test." },
  });
  return { subject: `تم تأكيد نتيجتك · Your final score is confirmed (${pct(d.percent)})`, html, text };
}

// ─── server: send once ─────────────────────────────────────────────────────

type Loaded = {
  to: string;
  data: ResultsEmailData;
  provisionalPercent: number | null;
};

function isMissingColumn(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

async function loadEmailData(attemptId: string): Promise<Loaded | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data: a } = await service
    .from("cc_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle<{ id: string; user_id: string; test_id: string; status: string; percent: number | null; band: CcBand | null; provisional_percent?: number | null }>();
  if (!a || a.percent == null || !a.band) return null;
  const [{ data: p }, { data: t }] = await Promise.all([
    service.from("cc_profiles").select("email,full_name,full_name_ar,preferred_locale").eq("id", a.user_id).maybeSingle<{
      email: string | null;
      full_name: string | null;
      full_name_ar: string | null;
      preferred_locale: string | null;
    }>(),
    service.from("cc_tests").select("title_en,title_ar").eq("id", a.test_id).maybeSingle<{ title_en: string; title_ar: string }>(),
  ]);
  if (!p?.email) return null;
  const locale: Locale = p.preferred_locale === "ar" ? "ar" : "en";
  const first = (s: string | null) => (s ?? "").trim().split(/\s+/)[0] || null;
  return {
    to: p.email,
    provisionalPercent: a.provisional_percent ?? null,
    data: {
      name: locale === "ar" ? first(p.full_name_ar) ?? first(p.full_name) : first(p.full_name),
      testTitleEn: t?.title_en ?? "CAD Champions test",
      testTitleAr: t?.title_ar ?? t?.title_en ?? "اختبار CAD Champions",
      percent: Number(a.percent),
      band: a.band,
      provisional: a.status === "provisional",
      url: `${defaultSiteUrl()}${ccPath(locale, `/results/${a.id}`)}`,
    },
  };
}

/** Claims `column` (null -> now). Returns true when THIS call claimed it; null when the column is missing. */
async function claim(attemptId: string, column: "results_email_sent_at" | "final_email_sent_at", extra: Record<string, unknown> = {}): Promise<boolean | null> {
  const service = createServiceClient();
  if (!service) return false;
  const { data, error } = await service
    .from("cc_attempts")
    .update({ [column]: new Date().toISOString(), ...extra })
    .eq("id", attemptId)
    .is(column, null)
    .select("id");
  if (error) {
    if (isMissingColumn(error.code)) {
      console.warn("[cc-scoring] run migration 0081 to send result emails");
      return null;
    }
    console.error("[cc-scoring] email claim failed:", error.code ?? error.message);
    return false;
  }
  return !!data && data.length > 0;
}

async function release(attemptId: string, column: "results_email_sent_at" | "final_email_sent_at"): Promise<void> {
  const service = createServiceClient();
  if (!service) return;
  await service.from("cc_attempts").update({ [column]: null }).eq("id", attemptId);
}

/** "Your results are ready", once per attempt. Returns true when sent by this call. */
export async function sendResultsReadyEmail(attemptId: string): Promise<boolean> {
  try {
    const loaded = await loadEmailData(attemptId);
    if (!loaded) return false;
    const extra = loaded.data.provisional ? { provisional_percent: loaded.data.percent } : {};
    if ((await claim(attemptId, "results_email_sent_at", extra)) !== true) return false;
    const mail = renderResultsReadyEmail(loaded.data);
    const sent = await sendEmailResult({ to: [loaded.to], ...mail, idempotencyKey: `cc-results-${attemptId}` });
    if (!sent.ok) {
      console.error("[cc-scoring] results email failed:", sent.error);
      await release(attemptId, "results_email_sent_at");
      return false;
    }
    return true;
  } catch (e) {
    console.error("[cc-scoring] results email failed:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

/** "Your final score is confirmed", once, after a provisional attempt becomes graded. */
export async function sendFinalScoreEmail(attemptId: string): Promise<boolean> {
  try {
    const loaded = await loadEmailData(attemptId);
    if (!loaded || loaded.provisionalPercent == null || loaded.data.provisional) return false;
    if ((await claim(attemptId, "final_email_sent_at")) !== true) return false;
    const mail = renderFinalScoreEmail({ ...loaded.data, previousPercent: Number(loaded.provisionalPercent) });
    const sent = await sendEmailResult({ to: [loaded.to], ...mail, idempotencyKey: `cc-final-${attemptId}` });
    if (!sent.ok) {
      console.error("[cc-scoring] final email failed:", sent.error);
      await release(attemptId, "final_email_sent_at");
      return false;
    }
    return true;
  } catch (e) {
    console.error("[cc-scoring] final email failed:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}
