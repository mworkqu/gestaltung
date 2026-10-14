// Questions inbox (Prompt 8 Step E) — SERVER ONLY (service role). Callers
// check that the viewer is staff first.
//
// loadQuestions   grade queries ("Question this result") and lesson
//                 questions in one list: open first (oldest first), then the
//                 latest answered
// answerQuestion  saves the answer (answered_by / at, status answered),
//                 emails the student and returns where it links
// setQuestionPublic  "Show to everyone" for lesson questions

import type { Locale } from "@/i18n/routing";
import { defaultSiteUrl } from "@/lib/email/brand-layout";
import { createServiceClient } from "@/lib/supabase/service";

import { ccPath } from "../routes";
import { sendAnswerEmail } from "./emails";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/questions/server.ts is server-only");

export const ANSWER_MAX = 4000;
const LIST_LIMIT = 300;

const pick = (locale: Locale, en: string | null | undefined, ar: string | null | undefined) => ((locale === "ar" ? ar : en) || en || ar || "").trim();

function isMissing(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "42703";
}

export interface QuestionView {
  id: string;
  kind: "grade_query" | "lesson";
  status: "open" | "answered";
  body: string;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
  locale: "en" | "ar";
  isPublic: boolean;
  studentName: string;
  context: string;
  /** Results page (grade query) or training page (lesson). */
  href: string;
  /** Review screen for the task, when the task result is reviewable by staff. */
  reviewHref: string | null;
}

export type QuestionsLoad = { ok: true; items: QuestionView[] } | { ok: false; reason: "unavailable" | "not_set_up" | "error" };

type Row = {
  id: string;
  user_id: string;
  kind: string;
  lesson_id: string | null;
  attempt_id: string | null;
  task_result_id: string | null;
  body: string;
  locale: string;
  status: string;
  answer: string | null;
  answered_at: string | null;
  public: boolean;
  created_at: string;
};

export function linkFor(locale: Locale, q: Pick<Row, "kind" | "attempt_id">): string {
  return q.kind === "grade_query" && q.attempt_id ? ccPath(locale, `/results/${q.attempt_id}`) : ccPath(locale, "/training");
}

export async function loadQuestions(locale: Locale, filter: { status?: "open" | "answered" | null; kind?: "grade_query" | "lesson" | null } = {}): Promise<QuestionsLoad> {
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  try {
    let q = service.from("cc_lesson_questions").select("id,user_id,kind,lesson_id,attempt_id,task_result_id,body,locale,status,answer,answered_at,public,created_at");
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.kind) q = q.eq("kind", filter.kind);
    const { data, error } = await q.order("created_at", { ascending: true }).limit(LIST_LIMIT);
    if (error) return { ok: false, reason: isMissing(error.code) ? "not_set_up" : "error" };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return { ok: true, items: [] };

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const lessonIds = [...new Set(rows.flatMap((r) => (r.lesson_id ? [r.lesson_id] : [])))];
    const resultIds = [...new Set(rows.flatMap((r) => (r.task_result_id ? [r.task_result_id] : [])))];
    const [profilesRes, lessonsRes, resultsRes] = await Promise.all([
      service.from("cc_profiles").select("id,full_name,full_name_ar,email").in("id", userIds),
      lessonIds.length ? service.from("cc_lessons").select("*").in("id", lessonIds) : Promise.resolve({ data: [], error: null }),
      resultIds.length ? service.from("cc_task_results").select("id,task_id,status").in("id", resultIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const profiles = new Map(((profilesRes.data ?? []) as { id: string; full_name: string | null; full_name_ar: string | null; email: string | null }[]).map((p) => [p.id, p]));
    const lessons = new Map(((lessonsRes.data ?? []) as { id: string; title_en?: string | null; title_ar?: string | null }[]).map((l) => [l.id, pick(locale, l.title_en, l.title_ar)]));
    const results = (resultsRes.data ?? []) as { id: string; task_id: string; status: string }[];
    const resultTask = new Map(results.map((r) => [r.id, r]));
    const taskIds = [...new Set(results.map((r) => r.task_id))];
    const { data: taskRows } = taskIds.length ? await service.from("cc_test_tasks").select("id,title_en,title_ar").in("id", taskIds) : { data: [] };
    const tasks = new Map(((taskRows ?? []) as { id: string; title_en: string; title_ar: string }[]).map((t) => [t.id, pick(locale, t.title_en, t.title_ar)]));

    const items: QuestionView[] = rows.map((r) => {
      const p = profiles.get(r.user_id);
      const tr = r.task_result_id ? resultTask.get(r.task_result_id) : undefined;
      return {
        id: r.id,
        kind: r.kind === "lesson" ? "lesson" : "grade_query",
        status: r.status === "answered" ? "answered" : "open",
        body: r.body,
        answer: r.answer,
        answeredAt: r.answered_at,
        createdAt: r.created_at,
        locale: r.locale === "ar" ? "ar" : "en",
        isPublic: !!r.public,
        studentName: (p ? pick(locale, p.full_name, p.full_name_ar) : "") || p?.email || "",
        context: r.kind === "lesson" ? (r.lesson_id ? (lessons.get(r.lesson_id) ?? "") : "") : tr ? (tasks.get(tr.task_id) ?? "") : "",
        href: linkFor(locale, r),
        reviewHref: tr ? ccPath(locale, `/admin/review/${tr.id}`) : null,
      };
    });
    // Open first (oldest first), then answered (latest first).
    const open = items.filter((i) => i.status === "open");
    const answered = items.filter((i) => i.status === "answered").sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""));
    return { ok: true, items: [...open, ...answered] };
  } catch (e) {
    console.error("[cc-questions] load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export type AnswerResult = { ok: true; emailed: boolean } | { ok: false; error: "unavailable" | "not_found" | "empty" | "too_long" | "error" };

export async function answerQuestion(input: { questionId: string; answer: string; actorId: string }): Promise<AnswerResult> {
  const answer = (input.answer ?? "").trim();
  if (!answer) return { ok: false, error: "empty" };
  if (answer.length > ANSWER_MAX) return { ok: false, error: "too_long" };
  if (!/^[0-9a-f-]{36}$/i.test(input.questionId ?? "")) return { ok: false, error: "not_found" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "unavailable" };
  try {
    const { data: q } = await service.from("cc_lesson_questions").select("id,user_id,kind,attempt_id,body,status,answer").eq("id", input.questionId).maybeSingle<Row>();
    if (!q) return { ok: false, error: "not_found" };
    const at = new Date().toISOString();
    const { error } = await service
      .from("cc_lesson_questions")
      .update({ answer, answered_by: input.actorId, answered_at: at, status: "answered" })
      .eq("id", q.id);
    if (error) throw new Error(error.message);

    const { error: logErr } = await service.from("cc_audit_log").insert({
      actor_id: input.actorId,
      action: "question.answer",
      entity_type: "cc_lesson_questions",
      entity_id: q.id,
      before: { status: q.status, answer: q.answer },
      after: { status: "answered", answer },
    });
    if (logErr) console.error("[cc-questions] audit insert failed:", logErr.code ?? logErr.message);

    const { data: p } = await service.from("cc_profiles").select("email,full_name,full_name_ar,preferred_locale").eq("id", q.user_id).maybeSingle<{
      email: string | null;
      full_name: string | null;
      full_name_ar: string | null;
      preferred_locale: string | null;
    }>();
    let emailed = false;
    if (p?.email) {
      const locale: Locale = p.preferred_locale === "ar" ? "ar" : "en";
      const first = (s: string | null) => (s ?? "").trim().split(/\s+/)[0] || null;
      emailed = await sendAnswerEmail(
        p.email,
        {
          locale,
          name: locale === "ar" ? (first(p.full_name_ar) ?? first(p.full_name)) : first(p.full_name),
          kind: q.kind === "lesson" ? "lesson" : "grade_query",
          question: q.body,
          answer,
          url: `${defaultSiteUrl()}${linkFor(locale, q)}`,
        },
        q.id
      );
    }
    return { ok: true, emailed };
  } catch (e) {
    console.error("[cc-questions] answer failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}

export async function setQuestionPublic(input: { questionId: string; isPublic: boolean; actorId: string }): Promise<{ ok: boolean; error?: "not_found" | "not_lesson" | "not_answered" | "error" }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.questionId ?? "")) return { ok: false, error: "not_found" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "error" };
  const { data: q } = await service.from("cc_lesson_questions").select("id,kind,status,public").eq("id", input.questionId).maybeSingle<Row>();
  if (!q) return { ok: false, error: "not_found" };
  if (q.kind !== "lesson") return { ok: false, error: "not_lesson" };
  if (input.isPublic && q.status !== "answered") return { ok: false, error: "not_answered" };
  const { error } = await service.from("cc_lesson_questions").update({ public: input.isPublic }).eq("id", q.id);
  if (error) {
    console.error("[cc-questions] public toggle failed:", error.code ?? error.message);
    return { ok: false, error: "error" };
  }
  await service.from("cc_audit_log").insert({ actor_id: input.actorId, action: "question.public", entity_type: "cc_lesson_questions", entity_id: q.id, before: { public: q.public }, after: { public: input.isPublic } });
  return { ok: true };
}
