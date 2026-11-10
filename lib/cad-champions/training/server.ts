// Training data on the server (Prompt 9) — SERVER ONLY.
//
// Reads use the student's own session (RLS: published content, own progress)
// unless a function takes a client argument (the actions pass the service
// client after checking auth themselves). Everything degrades gracefully
// before migration 0083 has run ({ ok: false, reason: "not_set_up" }).
// Answers never pass through here: exercises are read from the
// cc_exercises_public view; hints / solution ids only in actions.ts.

import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import type { CcUser } from "../auth/server";
import type { CcCompetitionModuleCode, CcSkillAreaId } from "../db/types";
import { OFFICIAL_WEIGHTS } from "../scoring/config";
import { recommendTrainingPath, type PathStep } from "../scoring/core";
import { hasFullAccess, levelOpenWithoutEnrollment, type AccessContext } from "./access";
import { MODULE_FOR_SKILL_AREA, TRAINING_COURSE_SLUG } from "./catalog";
import { displayStreak } from "./gamification";
import { computeLadder, isExercisePassed, moduleProgress, type LevelState, type ModuleProgress } from "./ladder";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/training/server.ts is server-only");

export type Db = NonNullable<ReturnType<typeof createServiceClient>>;

export function pick(locale: Locale, en: string | null | undefined, ar: string | null | undefined): string {
  return (locale === "ar" ? ar || en : en || ar) ?? "";
}

export function isMissingSchema(code: string | undefined): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204" || code === "PGRST202";
}

async function userDb(): Promise<Db> {
  return (await createClient()) as unknown as Db;
}

// ─── access ──────────────────────────────────────────────────────────────

/** enrolled = cc_has_active_enrollment(user); staff from the session. Never throws. */
export async function getAccessContext(cc: CcUser): Promise<AccessContext> {
  if (cc.isStaff) return { enrolled: true, staff: true };
  try {
    const db = await userDb();
    const { data, error } = await db.rpc("cc_has_active_enrollment", { p_user: cc.user.id });
    if (error) {
      if (!isMissingSchema(error.code)) console.error("[cc-training] enrollment check failed:", error.code ?? error.message);
      return { enrolled: false, staff: false };
    }
    return { enrolled: data === true, staff: false };
  } catch (e) {
    console.error("[cc-training] enrollment check failed:", e instanceof Error ? e.message : "unknown");
    return { enrolled: false, staff: false };
  }
}

// ─── catalog ─────────────────────────────────────────────────────────────

export interface CatalogLesson {
  id: string;
  slug: string;
  sort: number;
  title_en: string;
  title_ar: string;
  minutes: number | null;
  isFreePreview: boolean;
  skillAreaId: CcSkillAreaId | null;
  competitionModule: CcCompetitionModuleCode | null;
}

export interface CatalogExercise {
  id: string;
  slug: string;
  sort: number;
  title_en: string;
  title_ar: string;
  minutes: number | null;
  passMark: number;
  isFreeSample: boolean;
  skillAreaId: CcSkillAreaId | null;
  competitionModule: CcCompetitionModuleCode | null;
  testId: string | null;
}

export interface CatalogLevel {
  id: string;
  number: number;
  title_en: string;
  title_ar: string;
  goal_en: string | null;
  goal_ar: string | null;
  unlockRule: unknown;
  lessons: CatalogLesson[];
  exercises: CatalogExercise[];
}

export interface CatalogModule {
  id: string;
  slug: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  why_en: string | null;
  why_ar: string | null;
  icon: string | null;
  isOrientation: boolean;
  skillAreaId: CcSkillAreaId | null;
  competitionModule: CcCompetitionModuleCode | null;
  sort: number;
  levels: CatalogLevel[];
}

export type CatalogResult = { ok: true; modules: CatalogModule[] } | { ok: false; reason: "not_set_up" | "error" };

type ModuleRow = {
  id: string;
  slug: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  why_it_matters_en: string | null;
  why_it_matters_ar: string | null;
  icon: string | null;
  is_orientation: boolean;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
  sort: number;
};
type LevelRow = { id: string; module_id: string; level_number: number; title_en: string; title_ar: string; goal_en: string | null; goal_ar: string | null; unlock_rule: unknown };
type LessonRow = {
  id: string;
  level_id: string;
  slug: string;
  sort: number;
  title_en: string;
  title_ar: string;
  duration_minutes: number | null;
  is_free_preview: boolean;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
};
type ExerciseRow = {
  id: string;
  level_id: string;
  slug: string;
  sort: number;
  title_en: string;
  title_ar: string;
  estimated_minutes: number | null;
  pass_mark: number | string;
  is_free_sample: boolean;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
  test_id: string | null;
};

const LESSON_LIST_COLUMNS = "id,level_id,slug,sort,title_en,title_ar,duration_minutes,is_free_preview,skill_area_id,competition_module";
const EXERCISE_LIST_COLUMNS = "id,level_id,slug,sort,title_en,title_ar,estimated_minutes,pass_mark,is_free_sample,skill_area_id,competition_module,test_id";

/**
 * The whole published catalog (no notes, no answers). `client` defaults to
 * the student's session; actions pass the service client (then only
 * published rows are read, filtered here).
 */
export async function loadCatalog(client?: Db): Promise<CatalogResult> {
  try {
    const db = client ?? (await userDb());
    const service = !!client;
    const { data: course, error: cErr } = await db.from("cc_courses").select("id").eq("slug", TRAINING_COURSE_SLUG).maybeSingle<{ id: string }>();
    if (cErr) return { ok: false, reason: isMissingSchema(cErr.code) ? "not_set_up" : "error" };
    if (!course) return { ok: false, reason: "not_set_up" };

    let mq = db
      .from("cc_modules")
      .select("id,slug,title_en,title_ar,description_en,description_ar,why_it_matters_en,why_it_matters_ar,icon,is_orientation,skill_area_id,competition_module,sort")
      .eq("course_id", course.id)
      .order("sort");
    if (service) mq = mq.eq("is_published", true);
    const { data: modules, error: mErr } = await mq;
    if (mErr) return { ok: false, reason: isMissingSchema(mErr.code) ? "not_set_up" : "error" };
    const mods = (modules ?? []) as ModuleRow[];
    const moduleIds = mods.map((m) => m.id);
    if (moduleIds.length === 0) return { ok: true, modules: [] };

    let lq = db.from("cc_levels").select("id,module_id,level_number,title_en,title_ar,goal_en,goal_ar,unlock_rule").in("module_id", moduleIds).order("level_number");
    if (service) lq = lq.eq("is_published", true);
    const { data: levels, error: lErr } = await lq;
    if (lErr) return { ok: false, reason: isMissingSchema(lErr.code) ? "not_set_up" : "error" };
    const lvls = (levels ?? []) as LevelRow[];
    const levelIds = lvls.map((l) => l.id);

    let lessonsQ = db.from("cc_lessons").select(LESSON_LIST_COLUMNS).in("level_id", levelIds.length ? levelIds : ["00000000-0000-0000-0000-000000000000"]).order("sort");
    if (service) lessonsQ = lessonsQ.eq("is_published", true);
    // The view already shows only published exercises to students; the service client reads the base table.
    const exQ = service
      ? db.from("cc_exercises").select(EXERCISE_LIST_COLUMNS).eq("is_published", true).in("level_id", levelIds.length ? levelIds : ["00000000-0000-0000-0000-000000000000"]).order("sort")
      : db.from("cc_exercises_public").select(EXERCISE_LIST_COLUMNS).in("level_id", levelIds.length ? levelIds : ["00000000-0000-0000-0000-000000000000"]).order("sort");
    const [{ data: lessons, error: lsErr }, { data: exercises, error: exErr }] = await Promise.all([lessonsQ, exQ]);
    if (lsErr || exErr) {
      const code = lsErr?.code ?? exErr?.code;
      return { ok: false, reason: isMissingSchema(code) ? "not_set_up" : "error" };
    }

    const lessonsBy = new Map<string, CatalogLesson[]>();
    for (const r of (lessons ?? []) as LessonRow[]) {
      const list = lessonsBy.get(r.level_id) ?? [];
      list.push({
        id: r.id,
        slug: r.slug,
        sort: r.sort,
        title_en: r.title_en,
        title_ar: r.title_ar,
        minutes: r.duration_minutes,
        isFreePreview: r.is_free_preview,
        skillAreaId: r.skill_area_id,
        competitionModule: r.competition_module,
      });
      lessonsBy.set(r.level_id, list);
    }
    const exBy = new Map<string, CatalogExercise[]>();
    for (const r of (exercises ?? []) as ExerciseRow[]) {
      const list = exBy.get(r.level_id) ?? [];
      list.push({
        id: r.id,
        slug: r.slug,
        sort: r.sort,
        title_en: r.title_en,
        title_ar: r.title_ar,
        minutes: r.estimated_minutes,
        passMark: Number(r.pass_mark) || 80,
        isFreeSample: r.is_free_sample,
        skillAreaId: r.skill_area_id,
        competitionModule: r.competition_module,
        testId: r.test_id,
      });
      exBy.set(r.level_id, list);
    }

    const out: CatalogModule[] = mods.map((m) => ({
      id: m.id,
      slug: m.slug,
      title_en: m.title_en,
      title_ar: m.title_ar,
      description_en: m.description_en,
      description_ar: m.description_ar,
      why_en: m.why_it_matters_en,
      why_ar: m.why_it_matters_ar,
      icon: m.icon,
      isOrientation: m.is_orientation,
      skillAreaId: m.skill_area_id,
      competitionModule: m.competition_module,
      sort: m.sort,
      levels: lvls
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: l.id,
          number: l.level_number,
          title_en: l.title_en,
          title_ar: l.title_ar,
          goal_en: l.goal_en,
          goal_ar: l.goal_ar,
          unlockRule: l.unlock_rule,
          lessons: lessonsBy.get(l.id) ?? [],
          exercises: exBy.get(l.id) ?? [],
        })),
    }));
    return { ok: true, modules: out };
  } catch (e) {
    console.error("[cc-training] catalog failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

// ─── progress ────────────────────────────────────────────────────────────

export interface LessonProgressInfo {
  lastSecond: number;
  percent: number;
  completed: boolean;
  updatedAt: string;
}

export interface TrainingProgress {
  bestPercent: Map<string, number>;
  attempts: Map<string, number>;
  failed: Map<string, number>;
  lastAttemptAt: Map<string, string>;
  lessons: Map<string, LessonProgressInfo>;
  completedLessons: Set<string>;
  manualUnlocks: Set<string>;
  xp: number;
  streak: number;
  badges: Set<string>;
  certificates: { moduleId: string; code: string; issuedAt: string }[];
}

export function emptyProgress(): TrainingProgress {
  return {
    bestPercent: new Map(),
    attempts: new Map(),
    failed: new Map(),
    lastAttemptAt: new Map(),
    lessons: new Map(),
    completedLessons: new Set(),
    manualUnlocks: new Set(),
    xp: 0,
    streak: 0,
    badges: new Set(),
    certificates: [],
  };
}

type AttemptRow = { exercise_id: string; percent: number | string | null; passed: boolean | null; status: string; created_at: string };

/** Progress of one student. `client` = service client (actions) or the student's session (pages). */
export async function loadProgress(userId: string, catalog: CatalogModule[], client?: Db): Promise<TrainingProgress> {
  const p = emptyProgress();
  try {
    const db = client ?? (await userDb());
    const testExercise = new Map<string, string[]>();
    for (const m of catalog) for (const l of m.levels) for (const e of l.exercises) if (e.testId) testExercise.set(e.testId, [...(testExercise.get(e.testId) ?? []), e.id]);

    const [att, lp, un, xp, bd, cert, tests] = await Promise.all([
      db.from("cc_exercise_attempts").select("exercise_id,percent,passed,status,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(2000),
      db.from("cc_lesson_progress").select("lesson_id,last_second,watched_percent,completed_at,updated_at").eq("user_id", userId),
      db.from("cc_level_unlocks").select("level_id").eq("user_id", userId),
      db.from("cc_student_xp").select("xp,streak_weeks,last_active_week").eq("user_id", userId).maybeSingle<{ xp: number; streak_weeks: number; last_active_week: string | null }>(),
      db.from("cc_badges").select("level_id").eq("user_id", userId),
      db.from("cc_certificates").select("module_id,code,issued_at").eq("user_id", userId),
      testExercise.size
        ? db.from("cc_attempts").select("test_id,percent,status").eq("user_id", userId).in("test_id", [...testExercise.keys()]).in("status", ["provisional", "graded"])
        : Promise.resolve({ data: [] as { test_id: string; percent: number | null; status: string }[], error: null }),
    ]);

    for (const r of (att.data ?? []) as AttemptRow[]) {
      if (!p.lastAttemptAt.has(r.exercise_id)) p.lastAttemptAt.set(r.exercise_id, r.created_at);
      if (r.status === "error") continue; // grader trouble: not the student's attempt
      p.attempts.set(r.exercise_id, (p.attempts.get(r.exercise_id) ?? 0) + 1);
      if (r.passed === false) p.failed.set(r.exercise_id, (p.failed.get(r.exercise_id) ?? 0) + 1);
      const pct = r.percent == null ? null : Number(r.percent);
      if (pct != null && Number.isFinite(pct) && pct > (p.bestPercent.get(r.exercise_id) ?? -1)) p.bestPercent.set(r.exercise_id, pct);
    }
    for (const r of (tests.data ?? []) as { test_id: string; percent: number | string | null }[]) {
      const pct = r.percent == null ? null : Number(r.percent);
      if (pct == null || !Number.isFinite(pct)) continue;
      for (const exId of testExercise.get(r.test_id) ?? []) {
        p.attempts.set(exId, (p.attempts.get(exId) ?? 0) + 1);
        if (pct > (p.bestPercent.get(exId) ?? -1)) p.bestPercent.set(exId, pct);
      }
    }
    for (const r of (lp.data ?? []) as { lesson_id: string; last_second: number; watched_percent: number | string; completed_at: string | null; updated_at: string }[]) {
      p.lessons.set(r.lesson_id, { lastSecond: r.last_second, percent: Number(r.watched_percent) || 0, completed: !!r.completed_at, updatedAt: r.updated_at });
      if (r.completed_at) p.completedLessons.add(r.lesson_id);
    }
    for (const r of (un.data ?? []) as { level_id: string }[]) p.manualUnlocks.add(r.level_id);
    if (xp.data) {
      p.xp = xp.data.xp ?? 0;
      p.streak = displayStreak({ streakWeeks: xp.data.streak_weeks ?? 0, lastActiveWeek: xp.data.last_active_week });
    }
    for (const r of (bd.data ?? []) as { level_id: string }[]) p.badges.add(r.level_id);
    p.certificates = ((cert.data ?? []) as { module_id: string; code: string; issued_at: string }[]).map((c) => ({ moduleId: c.module_id, code: c.code, issuedAt: c.issued_at }));
  } catch (e) {
    console.error("[cc-training] progress failed:", e instanceof Error ? e.message : "unknown");
  }
  return p;
}

// ─── ladders ─────────────────────────────────────────────────────────────

export interface ModuleView {
  module: CatalogModule;
  states: LevelState[];
  progress: ModuleProgress;
}

export function levelAccessible(access: AccessContext, module: CatalogModule, level: CatalogLevel): boolean {
  return (
    hasFullAccess(access) ||
    levelOpenWithoutEnrollment({
      isOrientation: module.isOrientation,
      hasFreePreviewLesson: level.lessons.some((l) => l.isFreePreview),
      hasFreeSampleExercise: level.exercises.some((e) => e.isFreeSample),
    })
  );
}

export function moduleView(module: CatalogModule, p: TrainingProgress, access: AccessContext): ModuleView {
  const states = computeLadder(
    module.levels.map((l) => ({
      id: l.id,
      levelNumber: l.number,
      unlockRule: l.unlockRule,
      exercises: l.exercises.map((e) => ({ id: e.id, passMark: e.passMark, minutes: e.minutes })),
      lessons: l.lessons.map((x) => ({ id: x.id, minutes: x.minutes })),
      accessible: levelAccessible(access, module, l),
    })),
    { bestPercent: p.bestPercent, completedLessons: p.completedLessons, manualUnlocks: p.manualUnlocks }
  );
  return { module, states, progress: moduleProgress(states) };
}

/** Where an item sits and whether its level is open for this student. */
export function locate(catalog: CatalogModule[], p: TrainingProgress, access: AccessContext, find: { lessonId?: string; exerciseId?: string }) {
  for (const m of catalog) {
    for (const l of m.levels) {
      const hit = find.lessonId ? l.lessons.some((x) => x.id === find.lessonId) : l.exercises.some((x) => x.id === find.exerciseId);
      if (!hit) continue;
      const view = moduleView(m, p, access);
      const state = view.states.find((s) => s.id === l.id) ?? null;
      return { module: m, level: l, state, view };
    }
  }
  return null;
}

// ─── continue + recommendations ──────────────────────────────────────────

export type ContinueItem = { kind: "lesson" | "exercise"; slug: string; title_en: string; title_ar: string; started: boolean } | null;

/** The last unfinished lesson, else the first open item that is not done yet. */
export function continueItem(catalog: CatalogModule[], views: ModuleView[], p: TrainingProgress): ContinueItem {
  const lessonsById = new Map<string, CatalogLesson>();
  for (const m of catalog) for (const l of m.levels) for (const x of l.lessons) lessonsById.set(x.id, x);
  const recent = [...p.lessons.entries()]
    .filter(([id, info]) => !info.completed && lessonsById.has(id))
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))[0];
  if (recent) {
    const l = lessonsById.get(recent[0])!;
    return { kind: "lesson", slug: l.slug, title_en: l.title_en, title_ar: l.title_ar, started: true };
  }
  for (const v of views) {
    for (const l of v.module.levels) {
      const s = v.states.find((x) => x.id === l.id);
      if (!s || s.status !== "unlocked") continue;
      const lesson = l.lessons.find((x) => !p.completedLessons.has(x.id));
      if (lesson) return { kind: "lesson", slug: lesson.slug, title_en: lesson.title_en, title_ar: lesson.title_ar, started: false };
      const ex = l.exercises.find((x) => !isExercisePassed(p.bestPercent.get(x.id), x.passMark));
      if (ex) return { kind: "exercise", slug: ex.slug, title_en: ex.title_en, title_ar: ex.title_ar, started: (p.attempts.get(ex.id) ?? 0) > 0 };
    }
  }
  return null;
}

export interface Recommendation {
  step: PathStep;
  module: CatalogModule;
  levelNumber: number | null;
}

/** "Recommended for you": the latest scored attempt's skill map -> modules. */
export async function loadRecommendations(userId: string, catalog: CatalogModule[]): Promise<Recommendation[]> {
  try {
    const db = await userDb();
    const { data: attempt } = await db
      .from("cc_attempts")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["provisional", "graded"])
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!attempt) return [];
    const { data: scores } = await db.from("cc_skill_scores").select("skill_area_id,percent,assessed").eq("attempt_id", attempt.id);
    const areas = ((scores ?? []) as { skill_area_id: CcSkillAreaId; percent: number | string | null; assessed: boolean }[]).map((s) => ({
      skillAreaId: s.skill_area_id,
      weight: OFFICIAL_WEIGHTS[s.skill_area_id] ?? 0,
      percent: s.percent == null ? null : Number(s.percent),
      assessed: s.assessed,
    }));
    const out: Recommendation[] = [];
    for (const step of recommendTrainingPath(areas).slice(0, 3)) {
      const target = MODULE_FOR_SKILL_AREA[step.skillAreaId];
      const found = catalog.find((m) => m.slug === target?.module);
      if (found) out.push({ step, module: found, levelNumber: target?.level ?? null });
    }
    return out;
  } catch (e) {
    console.error("[cc-training] recommendations failed:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

// ─── signed file links ───────────────────────────────────────────────────

export interface FileLink {
  label: string;
  url: string;
}

/** Signed links (10 minutes) for [{path, label_en, label_ar}] in a private bucket. Service role; call only after the access check. */
export async function signedFileLinks(bucket: string, files: unknown, locale: Locale): Promise<FileLink[]> {
  if (!Array.isArray(files) || files.length === 0) return [];
  const service = createServiceClient();
  if (!service) return [];
  const out: FileLink[] = [];
  for (const f of files.slice(0, 20)) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const path = typeof o.path === "string" ? o.path : "";
    if (!path || path.includes("..")) continue;
    const { data } = await service.storage.from(bucket).createSignedUrl(path, 600);
    if (!data?.signedUrl) continue;
    const label = pick(locale, typeof o.label_en === "string" ? o.label_en : "", typeof o.label_ar === "string" ? o.label_ar : "") || (path.split("/").pop() ?? path);
    out.push({ label, url: data.signedUrl });
  }
  return out;
}

// ─── page state ──────────────────────────────────────────────────────────

export type TrainingState =
  | { ok: true; catalog: CatalogModule[]; progress: TrainingProgress; access: AccessContext; views: ModuleView[] }
  | { ok: false; reason: "not_set_up" | "error" };

/** Everything a training page needs for the signed-in student. */
export async function loadTrainingState(cc: CcUser): Promise<TrainingState> {
  const [catalog, access] = await Promise.all([loadCatalog(), getAccessContext(cc)]);
  if (!catalog.ok) return catalog;
  const progress = await loadProgress(cc.user.id, catalog.modules);
  return { ok: true, catalog: catalog.modules, progress, access, views: catalog.modules.map((m) => moduleView(m, progress, access)) };
}
