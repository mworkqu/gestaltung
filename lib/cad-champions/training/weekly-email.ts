// Weekly training progress email (Prompt 9 Step E): what you did this week,
// what is next. Opt-out = cc_profiles.weekly_progress_email (Account page).
//
// renderWeeklyProgressEmail is PURE (tested). sendWeeklyProgressEmails is
// SERVER ONLY (service role), called by the cron route
// app/api/cron/cc-weekly-progress (CRON_SECRET). It only writes to students
// who have started training, at most once per Qatar week (Resend
// Idempotency-Key "cc-weekly-<user>-<week>").

import { sendEmailResult } from "@/lib/email";
import { defaultSiteUrl, renderBrandedEmail } from "@/lib/email/brand-layout";
import { createServiceClient } from "@/lib/supabase/service";

import { ccPath } from "../routes";
import { qatarWeekStart } from "./gamification";
import { continueItem, loadCatalog, loadProgress, moduleView, pick } from "./server";

export interface WeeklyEmailData {
  locale: "en" | "ar";
  name: string | null;
  lessonsDone: number;
  exercisesPassed: number;
  xp: number;
  streak: number;
  next: { title: string; url: string } | null;
  trainingUrl: string;
  settingsUrl: string;
}

const COPY = {
  en: {
    subject: "Your training this week",
    title: "Your training this week",
    hi: (n: string | null) => (n ? `Hi ${n},` : "Hi,"),
    did: (l: number, e: number) =>
      l + e === 0 ? "You did not train this week. One short session keeps your streak going." : `This week you finished ${l} lesson${l === 1 ? "" : "s"} and passed ${e} exercise${e === 1 ? "" : "s"}.`,
    xp: "XP",
    streak: "Week streak",
    next: "Next for you",
    allDone: "You have finished everything that is open to you. Great work.",
    button: "Continue training",
    reason: "You get this email because you train with CAD Champions.",
    unsubscribe: "Stop weekly progress emails",
  },
  ar: {
    subject: "تدريبك هذا الأسبوع",
    title: "تدريبك هذا الأسبوع",
    hi: (n: string | null) => (n ? `مرحبًا ${n}،` : "مرحبًا،"),
    did: (l: number, e: number) =>
      l + e === 0 ? "لم تتدرب هذا الأسبوع. جلسة قصيرة واحدة تكفي لتستمر أسابيعك المتتالية." : `هذا الأسبوع أنهيت ${l} من الدروس ونجحت في ${e} من التمارين.`,
    xp: "نقاط الخبرة",
    streak: "أسابيع متتالية",
    next: "خطوتك التالية",
    allDone: "أنهيت كل ما هو مفتوح لك. عمل رائع.",
    button: "تابع التدريب",
    reason: "وصلتك هذه الرسالة لأنك تتدرب مع CAD Champions.",
    unsubscribe: "أوقف رسائل التقدّم الأسبوعية",
  },
} as const;

export function renderWeeklyProgressEmail(d: WeeklyEmailData): { subject: string; html: string; text: string } {
  const c = COPY[d.locale === "ar" ? "ar" : "en"];
  const paragraphs = [c.hi(d.name), c.did(d.lessonsDone, d.exercisesPassed), d.next ? `${c.next}: ${d.next.title}` : c.allDone];
  const { html, text } = renderBrandedEmail({
    locale: d.locale,
    title: c.title,
    preheader: c.did(d.lessonsDone, d.exercisesPassed),
    paragraphs,
    facts: [
      { label: c.xp, value: String(d.xp), ltr: true },
      { label: c.streak, value: String(d.streak), ltr: true },
    ],
    buttons: [{ label: c.button, url: d.next?.url ?? d.trainingUrl }],
    footer: { reason: c.reason, unsubscribe: { label: c.unsubscribe, url: d.settingsUrl } },
  });
  return { subject: c.subject, html, text };
}

// ─── server ──────────────────────────────────────────────────────────────

export interface WeeklySummary {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
}

type ProfileRow = { id: string; email: string | null; full_name: string | null; full_name_ar: string | null; preferred_locale: "en" | "ar"; role: string };

export async function sendWeeklyProgressEmails(opts: { now?: Date; limit?: number } = {}): Promise<WeeklySummary | { error: string }> {
  if (typeof window !== "undefined") return { error: "server_only" };
  const service = createServiceClient();
  if (!service) return { error: "no_service_key" };
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const week = qatarWeekStart(now);
  const site = defaultSiteUrl();
  const summary: WeeklySummary = { considered: 0, sent: 0, skipped: 0, failed: 0 };

  const catalog = await loadCatalog(service);
  if (!catalog.ok) return { error: catalog.reason };

  // Students who have started training (any lesson progress or exercise attempt).
  const [{ data: lp }, { data: ea }] = await Promise.all([
    service.from("cc_lesson_progress").select("user_id").limit(5000),
    service.from("cc_exercise_attempts").select("user_id").limit(5000),
  ]);
  const active = [...new Set([...(lp ?? []), ...(ea ?? [])].map((r) => (r as { user_id: string }).user_id))];
  if (active.length === 0) return summary;

  const { data: profiles, error } = await service
    .from("cc_profiles")
    .select("id,email,full_name,full_name_ar,preferred_locale,role")
    .in("id", active.slice(0, 1000))
    .eq("weekly_progress_email", true)
    .is("deletion_requested_at", null)
    .not("email", "is", null)
    .limit(Math.max(1, Math.min(500, opts.limit ?? 200)));
  if (error) return { error: error.code ?? error.message };

  for (const p of (profiles ?? []) as ProfileRow[]) {
    summary.considered++;
    try {
      if (!p.email) {
        summary.skipped++;
        continue;
      }
      const locale = p.preferred_locale === "ar" ? "ar" : "en";
      const [{ count: lessons }, { data: passedRows }, enrolled] = await Promise.all([
        service.from("cc_lesson_progress").select("lesson_id", { count: "exact", head: true }).eq("user_id", p.id).gte("completed_at", since),
        service.from("cc_exercise_attempts").select("exercise_id").eq("user_id", p.id).eq("passed", true).gte("created_at", since),
        service.rpc("cc_has_active_enrollment", { p_user: p.id }),
      ]);
      const progress = await loadProgress(p.id, catalog.modules, service);
      const access = { enrolled: enrolled.data === true, staff: p.role !== "student" };
      const views = catalog.modules.map((m) => moduleView(m, progress, access));
      const next = continueItem(catalog.modules, views, progress);
      const data: WeeklyEmailData = {
        locale,
        name: (locale === "ar" ? p.full_name_ar || p.full_name : p.full_name || p.full_name_ar)?.split(" ")[0] ?? null,
        lessonsDone: lessons ?? 0,
        exercisesPassed: new Set(((passedRows ?? []) as { exercise_id: string }[]).map((r) => r.exercise_id)).size,
        xp: progress.xp,
        streak: progress.streak,
        next: next
          ? { title: pick(locale, next.title_en, next.title_ar), url: `${site}${ccPath(locale, `/training/${next.kind === "lesson" ? "lessons" : "exercises"}/${next.slug}`)}` }
          : null,
        trainingUrl: `${site}${ccPath(locale, "/training")}`,
        settingsUrl: `${site}${ccPath(locale, "/account")}`,
      };
      const mail = renderWeeklyProgressEmail(data);
      const res = await sendEmailResult({ to: [p.email], subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `cc-weekly-${p.id}-${week}` });
      if (res.ok) summary.sent++;
      else {
        summary.failed++;
        console.error("[cc-weekly] send failed:", res.error);
      }
    } catch (e) {
      summary.failed++;
      console.error("[cc-weekly] user failed:", e instanceof Error ? e.message : "unknown");
    }
  }
  return summary;
}
