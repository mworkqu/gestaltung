"use server";

// Training server actions (Prompt 9). Every action checks the CC session and
// the access rules itself (lib/cad-champions/training/access.ts), then reads
// answers / writes server-owned rows with the service role. The browser
// never receives reference data, hints it has not earned, or solution ids.

import { revalidatePath } from "next/cache";

import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { getCcUser } from "../auth/server";
import { CC_TRACK_SOFTWARE, type CcTrackSoftware } from "../db/types";
import { graderErrorInfo, isGraderErrorCode } from "../grader/error-codes";
import { graderConfigured } from "../grader/http";
import { isReferenceComplete, studentDetails, type AspectLite, type GraderMode } from "../grader/mapping";
import { gradeSubmissionNow, SUBMISSIONS_BUCKET } from "../grader/service";
import { markJourney } from "../journey/server";
import { ccPath, isCcLocale } from "../routes";
import { readObjectHead, verifyUploadedObject } from "../upload/server";
import { DEFAULT_MAX_BYTES, isPathUnderPrefix, isStepHeader } from "../upload/validate";
import { canRevealHint, canSeeSolution, canUseExercise, canWatchLesson, hintsAvailable } from "./access";
import { QUESTION_IMAGE_MAX_BYTES, QUESTION_MAX, exercisePrefix, questionPrefix } from "./catalog";
import { exercisePassed, exercisePercent, type ExerciseOutcome } from "./grading";
import { xpForPass } from "./gamification";
import { WATCHED_THRESHOLD } from "../videos/registry";
import { recordActivity, refreshModuleRewards } from "./rewards";
import { getAccessContext, isMissingSchema, loadCatalog, loadProgress, locate, type Db } from "./server";

const loc = (l: unknown): Locale => (isCcLocale(l) ? l : "en");
const SLUG = /^[a-z0-9-]{1,80}$/;

type LessonRow = {
  id: string;
  slug: string;
  is_free_preview: boolean;
  is_published: boolean;
  level_id: string;
  cc_levels: { level_number: number; module_id: string; cc_modules: { is_orientation: boolean } | { is_orientation: boolean }[] | null } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

async function lessonForAction(service: Db, slug: string, staff: boolean) {
  if (!SLUG.test(slug ?? "")) return null;
  const { data, error } = await service
    .from("cc_lessons")
    .select("id,slug,is_free_preview,is_published,level_id,cc_levels!inner(level_number,module_id,cc_modules!inner(is_orientation))")
    .eq("slug", slug)
    .maybeSingle<LessonRow>();
  if (error || !data || (!data.is_published && !staff)) return null;
  const level = one(data.cc_levels);
  const mod = one(level?.cc_modules);
  return { id: data.id, slug: data.slug, is_free_preview: data.is_free_preview, isOrientation: !!mod?.is_orientation, moduleId: level?.module_id ?? null };
}

// ─── lesson progress ─────────────────────────────────────────────────────

export type ProgressResult = { ok: true; completed: boolean; justCompleted: boolean } | { ok: false; reason: "signed_out" | "forbidden" | "not_found" | "error" };

async function writeProgress(slug: string, second: number, percent: number, forceComplete: boolean): Promise<ProgressResult> {
  const cc = await getCcUser();
  if (!cc?.profile && !cc?.isStaff) return { ok: false, reason: "signed_out" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "error" };
  try {
    const lesson = await lessonForAction(service, slug, cc.isStaff);
    if (!lesson) return { ok: false, reason: "not_found" };
    const access = await getAccessContext(cc);
    if (!canWatchLesson(access, lesson)) return { ok: false, reason: "forbidden" };
    const userId = cc.user.id;

    const { data: cur } = await service
      .from("cc_lesson_progress")
      .select("last_second,watched_percent,completed_at")
      .eq("user_id", userId)
      .eq("lesson_id", lesson.id)
      .maybeSingle<{ last_second: number; watched_percent: number | string; completed_at: string | null }>();
    const prevPct = Number(cur?.watched_percent ?? 0) || 0;
    const pct = Math.max(prevPct, Math.max(0, Math.min(100, percent)));
    const complete = !!cur?.completed_at || forceComplete || pct >= WATCHED_THRESHOLD * 100;
    const justCompleted = complete && !cur?.completed_at;
    const now = new Date().toISOString();
    const { error } = await service.from("cc_lesson_progress").upsert(
      {
        user_id: userId,
        lesson_id: lesson.id,
        last_second: Math.max(0, Math.min(86_400, Math.floor(second))),
        watched_percent: Math.round(pct * 100) / 100,
        completed_at: cur?.completed_at ?? (complete ? now : null),
        updated_at: now,
      },
      { onConflict: "user_id,lesson_id" }
    );
    if (error) {
      if (!isMissingSchema(error.code)) console.error("[cc-training] progress write failed:", error.code ?? error.message);
      return { ok: false, reason: "error" };
    }
    if (justCompleted) {
      await recordActivity(service, userId);
      if (lesson.moduleId) await refreshModuleRewards(service, userId, lesson.moduleId);
      if (lesson.is_free_preview || lesson.isOrientation) await markJourney(userId, "sample_lesson_watched_at");
    }
    return { ok: true, completed: complete, justCompleted };
  } catch (e) {
    console.error("[cc-training] progress failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Progress ping (every 15 s while playing): position + percent watched. Completes at 90 %. */
export async function saveLessonProgressAction(input: { slug: string; second: number; duration: number }): Promise<ProgressResult> {
  const second = Number(input?.second);
  const duration = Number(input?.duration);
  if (!Number.isFinite(second) || second < 0) return { ok: false, reason: "error" };
  const percent = Number.isFinite(duration) && duration > 0 ? (second / duration) * 100 : 0;
  return writeProgress(String(input?.slug ?? ""), second, percent, false);
}

/** "Mark as complete" (no player, or the student finished elsewhere). */
export async function markLessonCompleteAction(input: { slug: string; locale: string }): Promise<ProgressResult> {
  const res = await writeProgress(String(input?.slug ?? ""), 0, 0, true);
  if (res.ok) revalidatePath(ccPath(loc(input?.locale), "/training"));
  return res;
}

// ─── track switcher ──────────────────────────────────────────────────────

export async function setTrackAction(track: string): Promise<{ ok: boolean }> {
  if (!(CC_TRACK_SOFTWARE as readonly string[]).includes(track)) return { ok: false };
  const cc = await getCcUser();
  if (!cc?.profile) return { ok: false };
  try {
    // The student's own session: RLS allows updating their own row; the
    // profile trigger guards admin-only fields.
    const db = await createClient();
    const { error } = await db.from("cc_profiles").update({ track_software: track as CcTrackSoftware }).eq("id", cc.user.id);
    if (error) {
      console.error("[cc-training] track update failed:", error.code ?? error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("[cc-training] track update failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false };
  }
}

// ─── lesson questions ────────────────────────────────────────────────────

export type AskLessonResult = { ok: true } | { ok: false; error: "empty" | "too_long" | "signed_out" | "not_found" | "forbidden" | "too_many" | "bad_image" | "error" };

const MAX_OPEN_PER_LESSON = 3;

/** "Ask a question about this lesson": cc_lesson_questions kind 'lesson' (admin questions inbox). */
export async function askLessonQuestionAction(input: { slug: string; body: string; imagePath?: string | null; locale: string }): Promise<AskLessonResult> {
  const body = String(input?.body ?? "").trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > QUESTION_MAX) return { ok: false, error: "too_long" };
  const cc = await getCcUser();
  if (!cc?.profile) return { ok: false, error: "signed_out" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "error" };
  try {
    const lesson = await lessonForAction(service, String(input?.slug ?? ""), cc.isStaff);
    if (!lesson) return { ok: false, error: "not_found" };
    const access = await getAccessContext(cc);
    if (!canWatchLesson(access, lesson)) return { ok: false, error: "forbidden" };

    const { count } = await service
      .from("cc_lesson_questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", cc.user.id)
      .eq("lesson_id", lesson.id)
      .eq("status", "open");
    if ((count ?? 0) >= MAX_OPEN_PER_LESSON) return { ok: false, error: "too_many" };

    let imagePath: string | null = null;
    if (input?.imagePath) {
      if (!isPathUnderPrefix(input.imagePath, questionPrefix(cc.user.id))) return { ok: false, error: "bad_image" };
      const check = await verifyUploadedObject(SUBMISSIONS_BUCKET, input.imagePath, "image", QUESTION_IMAGE_MAX_BYTES);
      if (!check.ok) return { ok: false, error: "bad_image" };
      imagePath = input.imagePath;
    }

    // The student's own session: the insert policy allows only an open,
    // private, unanswered question of their own.
    const db = await createClient();
    const { error } = await db.from("cc_lesson_questions").insert({
      user_id: cc.user.id,
      kind: "lesson",
      lesson_id: lesson.id,
      body,
      image_path: imagePath,
      locale: loc(input?.locale),
    });
    if (error) {
      console.error("[cc-training] question failed:", error.code ?? error.message);
      return { ok: false, error: "error" };
    }
    revalidatePath(ccPath(loc(input?.locale), `/training/lessons/${lesson.slug}`));
    return { ok: true };
  } catch (e) {
    console.error("[cc-training] question failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}

// ─── exercises ───────────────────────────────────────────────────────────

type ExerciseRow = {
  id: string;
  slug: string;
  level_id: string;
  is_published: boolean;
  is_free_sample: boolean;
  expected_upload: string;
  grading_mode: string;
  grader_mode: GraderMode | null;
  max_points: number | string;
  pass_mark: number | string;
  reference_data: unknown;
  tolerances: unknown;
  density_kg_m3: number | null;
  hints_en: string[];
  hints_ar: string[];
  solution_video_id: string | null;
  test_id: string | null;
};

async function exerciseForAction(service: Db, slug: string, staff: boolean) {
  if (!SLUG.test(slug ?? "")) return null;
  const { data, error } = await service
    .from("cc_exercises")
    .select(
      "id,slug,level_id,is_published,is_free_sample,expected_upload,grading_mode,grader_mode,max_points,pass_mark,reference_data,tolerances,density_kg_m3,hints_en,hints_ar,solution_video_id,test_id"
    )
    .eq("slug", slug)
    .maybeSingle<ExerciseRow>();
  if (error || !data || (!data.is_published && !staff)) return null;
  return data;
}

/** Access + level check for an exercise (service client). */
async function exerciseGate(service: Db, ex: ExerciseRow, cc: NonNullable<Awaited<ReturnType<typeof getCcUser>>>) {
  const access = await getAccessContext(cc);
  if (!canUseExercise(access, ex)) return { ok: false as const, reason: "forbidden" as const };
  if (access.staff) return { ok: true as const, access };
  const catalog = await loadCatalog(service);
  if (!catalog.ok) return { ok: true as const, access };
  const progress = await loadProgress(cc.user.id, catalog.modules, service);
  const where = locate(catalog.modules, progress, access, { exerciseId: ex.id });
  if (where?.state?.status === "locked") return { ok: false as const, reason: "locked" as const };
  return { ok: true as const, access };
}

async function attemptStats(service: Db, userId: string, exerciseId: string) {
  const { data } = await service
    .from("cc_exercise_attempts")
    .select("percent,passed,status")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .limit(1000);
  const rows = ((data ?? []) as { percent: number | string | null; passed: boolean | null; status: string }[]).filter((r) => r.status !== "error");
  const best = rows.reduce((m, r) => (r.percent != null && Number(r.percent) > m ? Number(r.percent) : m), -1);
  return {
    attempts: rows.length,
    failed: rows.filter((r) => r.passed === false).length,
    passed: rows.some((r) => r.passed === true),
    best: best >= 0 ? best : null,
  };
}

export type GradeExerciseResult =
  | {
      ok: true;
      outcome: ExerciseOutcome;
      attemptId: string | null;
      percent: number | null;
      best: number | null;
      passMark: number;
      message: string | null;
      helpSlug: string | null;
      checks: { name: string; passed: boolean }[];
      hintsAvailable: number;
      solutionUnlocked: boolean;
      xpGained: number;
      newBadges: number;
      certificateCode: string | null;
    }
  | { ok: false; reason: "signed_out" | "not_found" | "forbidden" | "locked" | "bad_file" | "unavailable" | "error" };

/** Grades one uploaded exercise file now ("Checking your file..." -> result). Unlimited attempts; best score kept. */
export async function gradeExerciseAction(input: {
  slug: string;
  path: string;
  fileName: string;
  size: number;
  sha256: string;
  locale: string;
}): Promise<GradeExerciseResult> {
  const locale = loc(input?.locale);
  const cc = await getCcUser();
  if (!cc?.profile && !cc?.isStaff) return { ok: false, reason: "signed_out" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  try {
    const ex = await exerciseForAction(service, String(input?.slug ?? ""), cc.isStaff);
    if (!ex || ex.expected_upload === "none") return { ok: false, reason: "not_found" };
    const gate = await exerciseGate(service, ex, cc);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const userId = cc.user.id;
    const path = String(input?.path ?? "");
    if (!isPathUnderPrefix(path, exercisePrefix(userId, ex.id))) return { ok: false, reason: "forbidden" };

    const passMark = Number(ex.pass_mark) || 80;
    const before = await attemptStats(service, userId, ex.id);
    const base = {
      user_id: userId,
      exercise_id: ex.id,
      storage_path: path,
      file_name: String(input?.fileName ?? path.split("/").pop() ?? "").slice(0, 200),
      file_size: Number.isFinite(Number(input?.size)) ? Math.max(0, Math.floor(Number(input.size))) : null,
      sha256: /^[0-9a-f]{64}$/.test(String(input?.sha256 ?? "")) ? input.sha256 : null,
    };

    const insertAttempt = async (row: Record<string, unknown>) => {
      const { data, error } = await service.from("cc_exercise_attempts").insert({ ...base, ...row }).select("id").maybeSingle<{ id: string }>();
      if (error) {
        console.error("[cc-training] attempt write failed:", error.code ?? error.message);
        return null;
      }
      return data?.id ?? null;
    };
    const result = (outcome: ExerciseOutcome, extra: Partial<Extract<GradeExerciseResult, { ok: true }>> = {}): GradeExerciseResult => ({
      ok: true,
      outcome,
      attemptId: null,
      percent: null,
      best: before.best,
      passMark,
      message: null,
      helpSlug: null,
      checks: [],
      hintsAvailable: hintsAvailable(before.failed, ex.hints_en?.length ?? 0),
      solutionUnlocked: canSeeSolution({ hasVideo: !!ex.solution_video_id, passed: before.passed, attempts: before.attempts, staff: cc.isStaff }),
      xpGained: 0,
      newBadges: 0,
      certificateCode: null,
      ...extra,
    });

    // Drawings / manual exercises: saved for a trainer.
    if (ex.expected_upload !== "step" || ex.grading_mode !== "auto_step") {
      const accept = ex.expected_upload === "pdf" ? "pdf" : ex.expected_upload === "image" ? "image" : ex.expected_upload === "video" ? "video" : "pdf";
      const check = await verifyUploadedObject(SUBMISSIONS_BUCKET, path, accept, DEFAULT_MAX_BYTES);
      if (!check.ok) return check.code === "unavailable" ? { ok: false, reason: "unavailable" } : { ok: false, reason: "bad_file" };
      const attemptId = await insertAttempt({ status: ex.grading_mode === "ai_drawing" ? "ai_pending_review" : "pending" });
      await recordActivity(service, userId);
      return result("review", { attemptId });
    }

    // STEP: cheap header check first.
    const head = await readObjectHead(SUBMISSIONS_BUCKET, path);
    if (!head.ok) return head.reason === "missing" ? { ok: false, reason: "bad_file" } : { ok: false, reason: "unavailable" };
    const headCode = head.size <= 0 ? "E_EMPTY" : head.size > DEFAULT_MAX_BYTES ? "E_TOO_LARGE" : !isStepHeader(head.head) ? "E_NOT_STEP" : null;
    if (headCode) {
      const info = graderErrorInfo(headCode, locale);
      const attemptId = await insertAttempt({ status: "final", passed: false, percent: 0, score: 0, error_code: headCode, help_slug: info.helpSlug, graded_at: new Date().toISOString() });
      await recordActivity(service, userId);
      const failed = before.failed + 1;
      return result("failed", {
        attemptId,
        percent: 0,
        message: info.message,
        helpSlug: info.helpSlug,
        hintsAvailable: hintsAvailable(failed, ex.hints_en?.length ?? 0),
        solutionUnlocked: canSeeSolution({ hasVideo: !!ex.solution_video_id, passed: before.passed, attempts: before.attempts + 1, staff: cc.isStaff }),
      });
    }

    if (!graderConfigured() || !isReferenceComplete(ex.reference_data)) {
      const attemptId = await insertAttempt({ status: "pending" });
      await recordActivity(service, userId);
      return result("saved", { attemptId });
    }

    const { data: aspects } = await service.from("cc_task_aspects").select("id,check_key,max_points,method").eq("exercise_id", ex.id);
    const mode: GraderMode = ex.grader_mode ?? "practice";
    const graded = await gradeSubmissionNow({
      file: { bucket: SUBMISSIONS_BUCKET, path },
      mode,
      task: {
        id: ex.id,
        max_points: Number(ex.max_points) || 100,
        reference_data: ex.reference_data,
        tolerances: ex.tolerances,
        density_kg_m3: ex.density_kg_m3,
        aspects: ((aspects ?? []) as AspectLite[]).map((a) => ({ ...a, max_points: Number(a.max_points) })),
      },
      logId: `exercise:${ex.id}:${userId}`,
    });
    if (!graded.ok) {
      console.error("[cc-training] grade failed:", graded.reason, graded.error);
      const attemptId = await insertAttempt({ status: "error", error_code: graded.reason });
      if (attemptId) {
        await service
          .from("cc_grading_logs")
          .insert({ kind: "step", exercise_attempt_id: attemptId, duration_ms: graded.durationMs, error: graded.error.slice(0, 500), error_code: graded.reason, response: (graded.raw ?? null) as never });
      }
      return { ok: false, reason: "unavailable" };
    }

    const r = graded.result;
    const percent = exercisePercent(r);
    const passed = exercisePassed(percent, passMark) && !r.errorCode;
    const errorInfo = r.errorCode && isGraderErrorCode(r.errorCode) ? graderErrorInfo(r.errorCode, locale) : null;
    const feedback = errorInfo?.message ?? ((locale === "ar" ? r.feedbackAr : r.feedbackEn) || null);
    const attemptId = await insertAttempt({
      status: "auto",
      score: r.score,
      percent,
      passed,
      error_code: r.errorCode,
      help_slug: errorInfo?.helpSlug ?? r.helpSlug,
      feedback_en: r.feedbackEn || null,
      feedback_ar: r.feedbackAr || null,
      details: studentDetails(r, { fileName: base.file_name }),
      graded_at: new Date().toISOString(),
    });
    if (attemptId) {
      await service.from("cc_grading_logs").insert({ kind: "step", exercise_attempt_id: attemptId, duration_ms: graded.durationMs, response: (graded.raw ?? null) as never });
      if (graded.aspects.length > 0) {
        await service.from("cc_aspect_results").insert(
          graded.aspects.map((a) => ({ exercise_attempt_id: attemptId, aspect_id: a.aspectId, user_id: userId, passed: a.passed, points_awarded: a.points, graded_at: new Date().toISOString() }))
        );
      }
    }

    // Rewards: XP only on the first pass; streak on every graded attempt.
    let xpGained = 0;
    let newBadges = 0;
    let certificateCode: string | null = null;
    if (passed && !before.passed) {
      const { data: lvl } = await service.from("cc_levels").select("level_number,module_id").eq("id", ex.level_id).maybeSingle<{ level_number: number; module_id: string }>();
      xpGained = xpForPass(lvl?.level_number ?? 1);
      await recordActivity(service, userId, xpGained);
      if (lvl) {
        const rewards = await refreshModuleRewards(service, userId, lvl.module_id);
        newBadges = rewards.newBadges.length;
        certificateCode = rewards.certificateCode;
      }
    } else {
      await recordActivity(service, userId);
    }

    const attempts = before.attempts + 1;
    const failed = before.failed + (passed ? 0 : 1);
    const best = Math.max(before.best ?? -1, percent);
    revalidatePath(ccPath(locale, "/training"));
    return result(passed ? "passed" : "failed", {
      attemptId,
      percent,
      best: best >= 0 ? best : null,
      message: feedback,
      helpSlug: errorInfo?.helpSlug ?? r.helpSlug ?? null,
      checks: r.checks.map((c) => ({ name: c.name, passed: c.passed })),
      hintsAvailable: hintsAvailable(failed, ex.hints_en?.length ?? 0),
      solutionUnlocked: canSeeSolution({ hasVideo: !!ex.solution_video_id, passed: before.passed || passed, attempts, staff: cc.isStaff }),
      xpGained,
      newBadges,
      certificateCode,
    });
  } catch (e) {
    console.error("[cc-training] grade failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

// ─── hints ───────────────────────────────────────────────────────────────

export type HintResult = { ok: true; n: number; text: string } | { ok: false; reason: "signed_out" | "not_found" | "forbidden" | "not_yet" | "error" };

/** Hint n (1-based), only once the student has failed n times (server-side gate). */
export async function revealHintAction(input: { slug: string; n: number; locale: string }): Promise<HintResult> {
  const cc = await getCcUser();
  if (!cc?.profile && !cc?.isStaff) return { ok: false, reason: "signed_out" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "error" };
  try {
    const ex = await exerciseForAction(service, String(input?.slug ?? ""), cc.isStaff);
    if (!ex) return { ok: false, reason: "not_found" };
    const gate = await exerciseGate(service, ex, cc);
    if (!gate.ok) return { ok: false, reason: "forbidden" };
    const n = Number(input?.n);
    const hints = loc(input?.locale) === "ar" && (ex.hints_ar?.length ?? 0) > 0 ? ex.hints_ar : ex.hints_en;
    const stats = await attemptStats(service, cc.user.id, ex.id);
    const failed = cc.isStaff ? hints.length : stats.failed;
    if (!canRevealHint(n, failed, hints.length)) return { ok: false, reason: "not_yet" };
    return { ok: true, n, text: hints[n - 1] };
  } catch (e) {
    console.error("[cc-training] hint failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
