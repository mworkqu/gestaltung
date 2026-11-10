// Admin training content loaders (Prompt 11) — SERVER ONLY. The CALLER checks
// the role first (requireCcAdmin in the page). Uses the service client, which
// is needed for the lesson notes / videos / downloads columns that students
// can no longer select since migration 0083.

import type { CcCourse, CcLesson, CcLevel, CcModule } from "../db/types";
import { isUuid } from "./lessons";
import { adminDb, isMissingSchema, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/lessons-server.ts is server-only");

export type LoadResult<T> = { ok: true; data: T } | { ok: false; reason: "not_set_up" | "not_found" | "error" };

const LESSON_LIST_COLUMNS = "id,level_id,slug,sort,title_en,title_ar,duration_minutes,is_free_preview,is_published,video_inventor_en,video_inventor_ar,video_fusion_en,video_fusion_ar,video_solidworks_en,video_solidworks_ar,video_neutral_en,video_neutral_ar";

export type LessonListRow = Pick<
  CcLesson,
  | "id"
  | "level_id"
  | "slug"
  | "sort"
  | "title_en"
  | "title_ar"
  | "duration_minutes"
  | "is_free_preview"
  | "is_published"
  | "video_inventor_en"
  | "video_inventor_ar"
  | "video_fusion_en"
  | "video_fusion_ar"
  | "video_solidworks_en"
  | "video_solidworks_ar"
  | "video_neutral_en"
  | "video_neutral_ar"
>;

export interface TreeLevel extends CcLevel {
  lessons: LessonListRow[];
}
export interface TreeModule extends CcModule {
  levels: TreeLevel[];
}
export interface TreeCourse extends CcCourse {
  modules: TreeModule[];
}

function fail<T>(error: { code?: string; message?: string } | null | undefined, label: string): LoadResult<T> {
  if (isMissingSchema(error?.code)) return { ok: false, reason: "not_set_up" };
  console.error(`[cc-admin-lessons] ${label} failed:`, error?.code ?? error?.message ?? "unknown");
  return { ok: false, reason: "error" };
}

export async function loadCourseTree(db: AdminDb | null = adminDb()): Promise<LoadResult<TreeCourse[]>> {
  if (!db) return { ok: false, reason: "error" };
  try {
    const [courses, modules, levels, lessons] = await Promise.all([
      db.from("cc_courses").select("*").order("sort", { ascending: true }),
      db.from("cc_modules").select("*").order("sort", { ascending: true }),
      db.from("cc_levels").select("*").order("level_number", { ascending: true }),
      db.from("cc_lessons").select(LESSON_LIST_COLUMNS).order("sort", { ascending: true }).limit(2000),
    ]);
    const bad = courses.error ?? modules.error ?? levels.error ?? lessons.error;
    if (bad) return fail(bad, "tree");
    const byLevel = new Map<string, LessonListRow[]>();
    for (const l of (lessons.data ?? []) as LessonListRow[]) {
      const list = byLevel.get(l.level_id) ?? [];
      list.push(l);
      byLevel.set(l.level_id, list);
    }
    const levelsByModule = new Map<string, TreeLevel[]>();
    for (const lv of (levels.data ?? []) as CcLevel[]) {
      const list = levelsByModule.get(lv.module_id) ?? [];
      list.push({ ...lv, lessons: byLevel.get(lv.id) ?? [] });
      levelsByModule.set(lv.module_id, list);
    }
    const modulesByCourse = new Map<string, TreeModule[]>();
    for (const m of (modules.data ?? []) as CcModule[]) {
      const list = modulesByCourse.get(m.course_id) ?? [];
      list.push({ ...m, levels: levelsByModule.get(m.id) ?? [] });
      modulesByCourse.set(m.course_id, list);
    }
    return { ok: true, data: ((courses.data ?? []) as CcCourse[]).map((c) => ({ ...c, modules: modulesByCourse.get(c.id) ?? [] })) };
  } catch (e) {
    console.error("[cc-admin-lessons] tree failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export async function loadModule(id: string, db: AdminDb | null = adminDb()): Promise<LoadResult<CcModule>> {
  if (!db) return { ok: false, reason: "error" };
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const { data, error } = await db.from("cc_modules").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error, "module");
  return data ? { ok: true, data: data as CcModule } : { ok: false, reason: "not_found" };
}

export interface LevelPage {
  level: CcLevel;
  module: CcModule;
  lessons: LessonListRow[];
  /** Number of exercises in this level (a delete warning, no editor here). */
  exerciseCount: number;
}

export async function loadLevel(id: string, db: AdminDb | null = adminDb()): Promise<LoadResult<LevelPage>> {
  if (!db) return { ok: false, reason: "error" };
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const { data: level, error } = await db.from("cc_levels").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error, "level");
  if (!level) return { ok: false, reason: "not_found" };
  const lv = level as CcLevel;
  const [mod, lessons, ex] = await Promise.all([
    db.from("cc_modules").select("*").eq("id", lv.module_id).maybeSingle(),
    db.from("cc_lessons").select(LESSON_LIST_COLUMNS).eq("level_id", id).order("sort", { ascending: true }),
    db.from("cc_exercises").select("id", { count: "exact", head: true }).eq("level_id", id),
  ]);
  if (mod.error) return fail(mod.error, "level module");
  if (lessons.error) return fail(lessons.error, "level lessons");
  if (!mod.data) return { ok: false, reason: "not_found" };
  return { ok: true, data: { level: lv, module: mod.data as CcModule, lessons: (lessons.data ?? []) as LessonListRow[], exerciseCount: ex.error ? 0 : (ex.count ?? 0) } };
}

export interface LessonPage {
  lesson: CcLesson;
  level: CcLevel;
  module: CcModule;
}

export async function loadLesson(id: string, db: AdminDb | null = adminDb()): Promise<LoadResult<LessonPage>> {
  if (!db) return { ok: false, reason: "error" };
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const { data, error } = await db.from("cc_lessons").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error, "lesson");
  if (!data) return { ok: false, reason: "not_found" };
  const lesson = data as CcLesson;
  const { data: level, error: e2 } = await db.from("cc_levels").select("*").eq("id", lesson.level_id).maybeSingle();
  if (e2) return fail(e2, "lesson level");
  if (!level) return { ok: false, reason: "not_found" };
  const { data: mod, error: e3 } = await db.from("cc_modules").select("*").eq("id", (level as CcLevel).module_id).maybeSingle();
  if (e3) return fail(e3, "lesson module");
  if (!mod) return { ok: false, reason: "not_found" };
  return { ok: true, data: { lesson, level: level as CcLevel, module: mod as CcModule } };
}
