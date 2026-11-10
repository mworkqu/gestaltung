// Results data — SERVER ONLY. Loads one attempt with everything the results
// page, the report and the share page need, and turns it into a small view
// model. Reads with the service role: the CALLER must check that the viewer
// owns the attempt or is staff (compare view.userId) before rendering.
// Never returns answers: reference data and grader logs are not read; partial
// rules are used for the score only and never reach the view; aspect results
// expose only descriptions, hints and pass/fail.
// Scores are recomputed live with core.ts, so the page is right even when
// cc_skill_scores has not been written yet.

import type { Locale } from "@/i18n/routing";
import { createServiceClient } from "@/lib/supabase/service";

import type { CcBand, CcCompetitionModuleCode } from "../db/types";
import { graderErrorInfo } from "../grader/error-codes";
import { attemptEndedAt } from "../test/status";
import { retakeAvailableAt } from "../test/timer";
import { OFFICIAL_WEIGHTS, type CcLevel } from "./config";
import {
  moduleReadiness,
  recommendTrainingPath,
  scoreAttempt,
  type AspectInput,
  type AspectResultInput,
  type AttemptOutcome,
  type PathStep,
  type TaskInput,
  type TaskResultInput,
} from "./core";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/scoring/load.ts is server-only");

export type GradingMethod = "auto" | "checklist" | "trainer";

export interface TaskCardView {
  id: string;
  number: number;
  title: string;
  skillAreaId: number;
  skillName: string | null;
  moduleCode: CcCompetitionModuleCode | null;
  moduleName: string | null;
  earned: number;
  max: number;
  method: GradingMethod;
  status: string;
  hasFile: boolean;
  /** Waiting for the grader (auto task still pending). */
  checking: boolean;
  /** A trainer still has to confirm this task. */
  waitingTrainer: boolean;
  /** Grading error a trainer is now checking by hand. */
  manualCheck: boolean;
  feedback: string | null;
  reviewerComment: string | null;
  failed: { description: string; hint: string | null }[];
  judgements: { description: string; score: number | null }[];
  /** Drawing checklist (ai_drawing) still waiting for the trainer: show the "Checklist done" chip, no item results yet. */
  checklistPending: boolean;
  /** Drawing checklist after the trainer finalized it: every measurement item with pass / fail. */
  checklist: { description: string; hint: string | null; passed: boolean | null }[] | null;
  /** The reviewer comment shown is a machine translation. */
  commentMachineTranslated: boolean;
  /** The latest "Question this result" for this task, with the trainer's answer. */
  question: { body: string; answer: string | null; answeredAt: string | null; status: string } | null;
  error: { message: string; helpSlug: string } | null;
  taskResultId: string | null;
  queryOpen: boolean;
}

export interface AreaView {
  id: number;
  name: string;
  weight: number;
  percent: number | null;
  level: CcLevel | null;
  assessed: boolean;
}

export interface ResultsView {
  attemptId: string;
  userId: string;
  status: string;
  outcome: AttemptOutcome;
  startedAt: string;
  submittedAt: string | null;
  submitReason: string | null;
  percent: number | null;
  band: CcBand | null;
  shareEnabled: boolean;
  shareToken: string | null;
  timeUsedMinutes: number | null;
  timeAllowedMinutes: number | null;
  retakeAt: number | null;
  test: { id: string; slug: string; title: string; titleEn: string; titleAr: string; type: string };
  studentName: string | null;
  areas: AreaView[];
  modules: { code: CcCompetitionModuleCode; name: string; percent: number; level: CcLevel }[];
  tasks: TaskCardView[];
  path: PathStep[];
  anyManualCheck: boolean;
}

export type LoadResult = { ok: true; view: ResultsView } | { ok: false; reason: "not_found" | "not_set_up" | "unavailable" | "error" };

const pick = (locale: Locale, en: string | null | undefined, ar: string | null | undefined) => ((locale === "ar" ? ar : en) || en || ar || "").trim();

function method(mode: string): GradingMethod {
  return mode === "auto_step" ? "auto" : mode === "ai_drawing" ? "checklist" : "trainer";
}

function isMissing(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "42703";
}

type AttemptRow = {
  id: string;
  user_id: string;
  test_id: string;
  status: string;
  started_at: string;
  submitted_at: string | null;
  submit_reason: string | null;
  deadline_at: string | null;
  percent: number | string | null;
  band: CcBand | null;
  share_enabled: boolean | null;
  share_token: string | null;
};

type TaskRow = TaskInput & { position: number; title_en: string; title_ar: string };
type ResultRow = TaskResultInput & {
  id: string;
  error_code: string | null;
  help_slug: string | null;
  feedback_en: string | null;
  feedback_ar: string | null;
  reviewer_comment_en: string | null;
  reviewer_comment_ar: string | null;
  details?: Record<string, unknown> | null;
};
type AspectRow = AspectInput & { description_en: string; description_ar: string; student_hint_en: string | null; student_hint_ar: string | null; position: number };
type AspectResultRow = AspectResultInput & { task_result_id: string };

export async function loadResultsView(attemptId: string, locale: Locale): Promise<LoadResult> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId ?? "")) return { ok: false, reason: "not_found" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  try {
    const { data: attempt, error: aErr } = await service.from("cc_attempts").select("*").eq("id", attemptId).maybeSingle<AttemptRow>();
    if (aErr) return { ok: false, reason: isMissing(aErr.code) ? "not_set_up" : "error" };
    if (!attempt) return { ok: false, reason: "not_found" };

    const [testRes, tasksRes, resultsRes, areasRes, modulesRes, profileRes, queriesRes] = await Promise.all([
      service.from("cc_tests").select("id,slug,title_en,title_ar,type,time_limit_minutes,retake_cooldown_days").eq("id", attempt.test_id).maybeSingle<{
        id: string;
        slug: string;
        title_en: string;
        title_ar: string;
        type: string;
        time_limit_minutes: number | null;
        retake_cooldown_days: number;
      }>(),
      service.from("cc_test_tasks").select("id,position,title_en,title_ar,skill_area_id,competition_module,max_points,grading_mode").eq("test_id", attempt.test_id).order("position"),
      service
        .from("cc_task_results")
        .select("id,task_id,status,submission_id,final_score,manual_score,ai_score,auto_score,needs_manual_review,error_code,help_slug,feedback_en,feedback_ar,reviewer_comment_en,reviewer_comment_ar,details")
        .eq("attempt_id", attemptId),
      service.from("cc_skill_areas").select("id,name_en,name_ar,weight_percent").order("id"),
      service.from("cc_competition_modules").select("code,name_en,name_ar"),
      service.from("cc_profiles").select("full_name,full_name_ar").eq("id", attempt.user_id).maybeSingle<{ full_name: string | null; full_name_ar: string | null }>(),
      service
        .from("cc_lesson_questions")
        .select("task_result_id,status,body,answer,answered_at,created_at")
        .eq("attempt_id", attemptId)
        .eq("kind", "grade_query")
        .order("created_at", { ascending: true }),
    ]);
    if (tasksRes.error) throw new Error(tasksRes.error.message);
    if (resultsRes.error) throw new Error(resultsRes.error.message);
    const test = testRes.data;
    if (!test) return { ok: false, reason: "not_found" };

    const tasks = (tasksRes.data ?? []) as TaskRow[];
    const results = (resultsRes.data ?? []) as ResultRow[];
    const taskIds = tasks.map((t) => t.id);
    const resultIds = results.map((r) => r.id);
    const [aspectsRes, aspectResultsRes] = await Promise.all([
      taskIds.length
        ? service
            .from("cc_task_aspects")
            .select("id,task_id,position,skill_area_id,competition_module,type,max_points,partial_rule,description_en,description_ar,student_hint_en,student_hint_ar")
            .in("task_id", taskIds)
            .order("position")
        : Promise.resolve({ data: [], error: null }),
      resultIds.length
        ? service.from("cc_aspect_results").select("task_result_id,aspect_id,passed,judgement_score,points_awarded").in("task_result_id", resultIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const aspects = (aspectsRes.error ? [] : (aspectsRes.data ?? [])) as AspectRow[];
    const aspectResults = (aspectResultsRes.error ? [] : (aspectResultsRes.data ?? [])) as AspectResultRow[];

    const areaRows = (areasRes.data ?? []) as { id: number; name_en: string; name_ar: string; weight_percent: number | string }[];
    const weights: Record<number, number> = { ...OFFICIAL_WEIGHTS };
    for (const a of areaRows) if (Number.isFinite(Number(a.weight_percent))) weights[Number(a.id)] = Number(a.weight_percent);
    const areaName = new Map(areaRows.map((a) => [Number(a.id), pick(locale, a.name_en, a.name_ar)]));
    const moduleName = new Map(((modulesRes.data ?? []) as { code: string; name_en: string; name_ar: string }[]).map((m) => [m.code, pick(locale, m.name_en, m.name_ar)]));

    const scores = scoreAttempt({ tasks, aspects, aspectResults, results, weights });
    const resultByTask = new Map(results.map((r) => [r.task_id, r]));
    const arByAspect = new Map(aspectResults.map((r) => [r.aspect_id, r]));
    const queryRows = (queriesRes.error ? [] : (queriesRes.data ?? [])) as {
      task_result_id: string | null;
      status: string;
      body?: string;
      answer?: string | null;
      answered_at?: string | null;
    }[];
    const openQueries = new Set(queryRows.filter((q) => q.status === "open" && q.task_result_id).map((q) => q.task_result_id as string));
    const latestQuery = new Map(queryRows.filter((q) => q.task_result_id).map((q) => [q.task_result_id as string, q]));

    const taskViews: TaskCardView[] = tasks.map((t, i) => {
      const r = resultByTask.get(t.id);
      const ts = scores.tasks.find((x) => x.taskId === t.id)!;
      const hasFile = !!r?.submission_id;
      const own = aspects.filter((a) => a.task_id === t.id);
      const failed: TaskCardView["failed"] = [];
      const judgements: TaskCardView["judgements"] = [];
      const isChecklist = t.grading_mode === "ai_drawing";
      const checklistFinal = isChecklist && hasFile && r?.status === "final";
      const checklistPending = isChecklist && hasFile && !!r && r.status !== "final" && r.status !== "error";
      const checklist: TaskCardView["checklist"] = checklistFinal ? [] : null;
      if (hasFile && !checklistPending) {
        for (const a of own) {
          const ar = arByAspect.get(a.id);
          if (a.type === "judgement") {
            judgements.push({ description: pick(locale, a.description_en, a.description_ar), score: ar?.judgement_score ?? null });
          } else if (checklist) {
            checklist.push({
              description: pick(locale, a.description_en, a.description_ar),
              hint: ar?.passed === false ? pick(locale, a.student_hint_en, a.student_hint_ar) || null : null,
              passed: ar?.passed ?? null,
            });
          } else if (ar && ar.passed === false) {
            failed.push({ description: pick(locale, a.description_en, a.description_ar), hint: pick(locale, a.student_hint_en, a.student_hint_ar) || null });
          }
        }
      }
      const checking = hasFile && r?.status === "pending" && t.grading_mode === "auto_step";
      const manualCheck = hasFile && r?.status === "error" && !!r.needs_manual_review;
      const waitingTrainer =
        hasFile && !checking && (r?.status === "ai_pending_review" || (r?.status === "pending" && t.grading_mode !== "auto_step") || ts.units.some((u) => u.unscored));
      const err = r?.error_code && !manualCheck ? graderErrorInfo(r.error_code, locale) : null;
      return {
        id: t.id,
        number: i + 1,
        title: pick(locale, t.title_en, t.title_ar),
        skillAreaId: Number(t.skill_area_id),
        skillName: areaName.get(Number(t.skill_area_id)) ?? null,
        moduleCode: (t.competition_module as CcCompetitionModuleCode | null) ?? null,
        moduleName: t.competition_module ? (moduleName.get(t.competition_module) ?? null) : null,
        earned: ts.earned,
        max: ts.max,
        method: method(String(t.grading_mode)),
        status: r?.status ?? "pending",
        hasFile,
        checking,
        waitingTrainer,
        manualCheck,
        feedback: r ? pick(locale, r.feedback_en, r.feedback_ar) || null : null,
        reviewerComment: r ? pick(locale, r.reviewer_comment_en, r.reviewer_comment_ar) || null : null,
        failed,
        judgements,
        checklistPending,
        checklist,
        commentMachineTranslated: !!r && r.details?.comment_machine_translated === locale && !!(locale === "ar" ? r.reviewer_comment_ar : r.reviewer_comment_en),
        question: (() => {
          const q = r ? latestQuery.get(r.id) : undefined;
          return q ? { body: q.body ?? "", answer: q.answer ?? null, answeredAt: q.answered_at ?? null, status: q.status } : null;
        })(),
        error: err ? { message: err.message, helpSlug: r?.help_slug || err.helpSlug } : null,
        taskResultId: r?.id ?? null,
        queryOpen: r ? openQueries.has(r.id) : false,
      };
    });

    const areas: AreaView[] = scores.areas.map((a) => ({
      id: a.skillAreaId,
      name: areaName.get(a.skillAreaId) ?? String(a.skillAreaId),
      weight: a.weight,
      percent: a.percent,
      level: a.level,
      assessed: a.assessed,
    }));
    const modules = moduleReadiness(scores.units).map((m) => ({ code: m.module, name: moduleName.get(m.module) ?? m.module, percent: m.percent, level: m.level }));

    const start = Date.parse(attempt.started_at);
    const end = attempt.submitted_at ? Date.parse(attempt.submitted_at) : NaN;
    const used = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 60000)) : null;
    const allowed = test.time_limit_minutes ?? null;

    const dbPercent = attempt.percent == null ? null : Number(attempt.percent);
    const finished = attempt.status === "provisional" || attempt.status === "graded";

    return {
      ok: true,
      view: {
        attemptId: attempt.id,
        userId: attempt.user_id,
        status: attempt.status,
        outcome: scores.outcome,
        startedAt: attempt.started_at,
        submittedAt: attempt.submitted_at,
        submitReason: attempt.submit_reason,
        // The stored percent is what the email said; fall back to the live one.
        percent: finished ? (dbPercent ?? scores.overall) : scores.overall,
        band: finished ? (attempt.band ?? scores.band) : scores.band,
        shareEnabled: !!attempt.share_enabled,
        shareToken: attempt.share_token,
        timeUsedMinutes: used == null ? null : allowed != null ? Math.min(used, allowed) : used,
        timeAllowedMinutes: allowed,
        retakeAt: retakeAvailableAt(
          attemptEndedAt({ id: attempt.id, status: attempt.status, started_at: attempt.started_at, deadline_at: attempt.deadline_at, submitted_at: attempt.submitted_at }),
          Number(test.retake_cooldown_days) || 0
        ),
        test: { id: test.id, slug: test.slug, title: pick(locale, test.title_en, test.title_ar), titleEn: test.title_en, titleAr: test.title_ar, type: test.type },
        studentName: profileRes.data ? pick(locale, profileRes.data.full_name, profileRes.data.full_name_ar) || null : null,
        areas,
        modules,
        tasks: taskViews,
        path: recommendTrainingPath(scores.areas),
        anyManualCheck: taskViews.some((t) => t.manualCheck),
      },
    };
  } catch (e) {
    console.error("[cc-results] load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

// ─── list + training data ───────────────────────────────────────────────────

export interface AttemptListItem {
  id: string;
  testTitle: string;
  status: string;
  percent: number | null;
  band: CcBand | null;
  startedAt: string;
  submittedAt: string | null;
  retakeAt: number | null;
  testSlug: string;
}

/** The user's finished attempts, newest first (service role; pass the signed-in user's id only). */
export async function loadUserAttempts(userId: string, locale: Locale): Promise<{ ok: true; items: AttemptListItem[] } | { ok: false }> {
  const service = createServiceClient();
  if (!service) return { ok: false };
  try {
    const { data, error } = await service
      .from("cc_attempts")
      .select("id,status,percent,band,started_at,submitted_at,deadline_at,test_id")
      .eq("user_id", userId)
      .neq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) return { ok: false };
    const rows = (data ?? []) as {
      id: string;
      status: string;
      percent: number | string | null;
      band: CcBand | null;
      started_at: string;
      submitted_at: string | null;
      deadline_at: string | null;
      test_id: string;
    }[];
    const testIds = [...new Set(rows.map((r) => r.test_id))];
    const { data: tests } = testIds.length
      ? await service.from("cc_tests").select("id,slug,title_en,title_ar,type,retake_cooldown_days").in("id", testIds)
      : { data: [] };
    const byId = new Map(((tests ?? []) as { id: string; slug: string; title_en: string; title_ar: string; type: string; retake_cooldown_days: number }[]).map((t) => [t.id, t]));
    const items = rows
      .filter((r) => {
        const t = byId.get(r.test_id);
        return t && t.type !== "practice" && t.type !== "exercise";
      })
      .map((r) => {
        const t = byId.get(r.test_id)!;
        return {
          id: r.id,
          testTitle: pick(locale, t.title_en, t.title_ar),
          testSlug: t.slug,
          status: r.status,
          percent: r.percent == null ? null : Number(r.percent),
          band: r.band,
          startedAt: r.started_at,
          submittedAt: r.submitted_at,
          retakeAt: retakeAvailableAt(attemptEndedAt({ ...r }), Number(t.retake_cooldown_days) || 0),
        };
      });
    return { ok: true, items };
  } catch {
    return { ok: false };
  }
}

export interface FreeLesson {
  slug: string;
  title: string;
  minutes: number | null;
}

export interface PlanOffer {
  name: string;
  /** null = "Price coming soon" (0084 seeds plans without a price until the owner sets it). */
  priceQar: number | null;
  durationDays: number | null;
  includes: string[];
}

/** First free-preview lesson for a skill area (falls back to any free preview); null before Prompt 9 content exists. */
export async function loadFreeLesson(skillAreaId: number | null, locale: Locale): Promise<FreeLesson | null> {
  const service = createServiceClient();
  if (!service) return null;
  try {
    const { data, error } = await service
      .from("cc_lessons")
      .select("slug,title_en,title_ar,duration_minutes,sort,cc_levels!inner(level_number,cc_modules!inner(skill_area_id,sort))")
      .eq("is_free_preview", true)
      .eq("is_published", true)
      .limit(50);
    if (error || !data || data.length === 0) return null;
    type Row = { slug: string; title_en: string; title_ar: string; duration_minutes: number | null; sort: number; cc_levels: unknown };
    const rows = data as Row[];
    const meta = (r: Row) => {
      const lvl = (Array.isArray(r.cc_levels) ? r.cc_levels[0] : r.cc_levels) as { level_number?: number; cc_modules?: unknown } | null;
      const mod = (Array.isArray(lvl?.cc_modules) ? lvl?.cc_modules[0] : lvl?.cc_modules) as { skill_area_id?: number | null } | null;
      return { area: mod?.skill_area_id ?? null, level: lvl?.level_number ?? 99 };
    };
    const sorted = [...rows].sort((a, b) => meta(a).level - meta(b).level || a.sort - b.sort);
    const best = (skillAreaId != null ? sorted.find((r) => meta(r).area === skillAreaId) : undefined) ?? sorted.find((r) => meta(r).area === 3) ?? sorted[0];
    return best ? { slug: best.slug, title: pick(locale, best.title_en, best.title_ar), minutes: best.duration_minutes } : null;
  } catch {
    return null;
  }
}

/** The featured active training plan (or the first active one; never the kit add-on); null before 0084 adds plans. */
export async function loadPlanOffer(locale: Locale): Promise<PlanOffer | null> {
  const service = createServiceClient();
  if (!service) return null;
  try {
    const { data, error } = await service
      .from("cc_plans")
      .select("*")
      .eq("is_active", true)
      .order("is_featured", { ascending: false })
      .order("sort")
      .limit(5);
    if (error || !data || data.length === 0) return null;
    type Row = { kind?: string; name_en: string; name_ar: string; price_qar: number | string | null; duration_days: number | null; includes_en: string[]; includes_ar: string[] };
    const p = (data as Row[]).find((r) => r.kind !== "kit");
    if (!p) return null;
    const includes = (locale === "ar" && p.includes_ar?.length ? p.includes_ar : p.includes_en) ?? [];
    const price = p.price_qar == null ? null : Number(p.price_qar);
    return {
      name: pick(locale, p.name_en, p.name_ar),
      priceQar: price != null && Number.isFinite(price) ? price : null,
      durationDays: p.duration_days ?? null,
      includes,
    };
  } catch {
    return null;
  }
}
