// Test / exercise builder loaders — SERVER ONLY (service role; the pages
// already passed requireCcAdmin). Answers (reference_data, rubric,
// tolerances) are read here and only ever sent to admin pages.

import type { CcCompetitionModule, CcExercise, CcLevel, CcModule, CcSkillArea, CcTaskAspect, CcTest, CcTestTask } from "../db/types";
import { graderConfigured } from "../grader/http";
import { aspectSplit, type AspectSplit } from "./aspects";
import { exercisePublishChecks, publishChecks, type PublishCheckResult } from "./publish-check";
import { adminDb, isMissingSchema, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/test-builder-server.ts is server-only");

export type LoadFail = { ok: false; reason: "not_set_up" | "unavailable" | "error" | "not_found" };
export type Loaded<T> = ({ ok: true } & T) | LoadFail;

export type SkillOption = Pick<CcSkillArea, "id" | "name_en" | "name_ar">;
export type ModuleOption = Pick<CcCompetitionModule, "code" | "name_en" | "name_ar" | "hours">;

function fail(code: string | undefined | null): LoadFail {
  if (isMissingSchema(code)) return { ok: false, reason: "not_set_up" };
  return { ok: false, reason: "error" };
}

async function labels(db: AdminDb): Promise<{ skills: SkillOption[]; modules: ModuleOption[] }> {
  const [s, m] = await Promise.all([
    db.from("cc_skill_areas").select("id,name_en,name_ar").order("id"),
    db.from("cc_competition_modules").select("code,name_en,name_ar,hours,position").order("position"),
  ]);
  return {
    skills: ((s.data ?? []) as SkillOption[]).map((r) => ({ ...r, id: Number(r.id) as SkillOption["id"] })),
    modules: ((m.data ?? []) as (ModuleOption & { position: number })[]).map(({ code, name_en, name_ar, hours }) => ({ code, name_en, name_ar, hours })),
  };
}

// ------------------------------------------------------------------ tests

export interface TestListRow {
  id: string;
  slug: string;
  title_en: string;
  title_ar: string;
  type: CcTest["type"];
  upload_mode: CcTest["upload_mode"];
  is_published: boolean;
  admin_only: boolean;
  taskCount: number;
  points: number;
  split: AspectSplit;
}

export async function loadTestList(): Promise<Loaded<{ rows: TestListRow[] }>> {
  const db = adminDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    const t = await db.from("cc_tests").select("id,slug,title_en,title_ar,type,upload_mode,is_published,admin_only,created_at").order("created_at", { ascending: true });
    if (t.error) return fail(t.error.code);
    const tests = (t.data ?? []) as (Pick<CcTest, "id" | "slug" | "title_en" | "title_ar" | "type" | "upload_mode" | "is_published" | "admin_only">)[];
    const ids = tests.map((x) => x.id);
    const tasks = ids.length ? await db.from("cc_test_tasks").select("id,test_id,max_points").in("test_id", ids) : { data: [], error: null };
    if (tasks.error) return fail(tasks.error.code);
    const taskRows = (tasks.data ?? []) as { id: string; test_id: string; max_points: number }[];
    const taskIds = taskRows.map((x) => x.id);
    const aspects = taskIds.length ? await db.from("cc_task_aspects").select("task_id,type,max_points").in("task_id", taskIds) : { data: [], error: null };
    const aspectRows = (aspects.data ?? []) as { task_id: string; type: string; max_points: number }[];
    const testOf = new Map(taskRows.map((r) => [r.id, r.test_id]));
    const rows = tests.map((x) => {
      const mine = taskRows.filter((r) => r.test_id === x.id);
      return {
        ...x,
        taskCount: mine.length,
        points: Math.round(mine.reduce((s, r) => s + (Number(r.max_points) || 0), 0) * 100) / 100,
        split: aspectSplit(aspectRows.filter((a) => testOf.get(a.task_id) === x.id)),
      };
    });
    return { ok: true, rows };
  } catch (e) {
    console.error("[cc-admin-tests] list failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export interface TestEditorData {
  test: CcTest;
  tasks: CcTestTask[];
  aspects: CcTaskAspect[];
  skills: SkillOption[];
  modules: ModuleOption[];
  graderReady: boolean;
  checks: PublishCheckResult;
}

export async function loadTestEditor(slug: string): Promise<Loaded<TestEditorData>> {
  const db = adminDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    const t = await db.from("cc_tests").select("*").eq("slug", slug).maybeSingle<CcTest>();
    if (t.error) return fail(t.error.code);
    if (!t.data) return { ok: false, reason: "not_found" };
    const test = t.data;
    const tasksRes = await db.from("cc_test_tasks").select("*").eq("test_id", test.id).order("position", { ascending: true });
    if (tasksRes.error) return fail(tasksRes.error.code);
    const tasks = (tasksRes.data ?? []) as CcTestTask[];
    const taskIds = tasks.map((x) => x.id);
    const aspectsRes = taskIds.length
      ? await db.from("cc_task_aspects").select("*").in("task_id", taskIds).order("position", { ascending: true })
      : { data: [], error: null };
    if (aspectsRes.error) return fail(aspectsRes.error.code);
    const aspects = (aspectsRes.data ?? []) as CcTaskAspect[];
    const l = await labels(db);
    return {
      ok: true,
      test,
      tasks,
      aspects,
      ...l,
      graderReady: graderConfigured(),
      checks: publishChecks({ test, tasks, aspects }),
    };
  } catch (e) {
    console.error("[cc-admin-tests] editor load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

// ------------------------------------------------------------------ exercises

export interface LevelOption {
  id: string;
  moduleId: string;
  moduleTitle_en: string;
  moduleTitle_ar: string;
  moduleSort: number;
  competition_module: CcModule["competition_module"];
  level_number: number;
  title_en: string;
  title_ar: string;
}

async function levelOptions(db: AdminDb): Promise<LevelOption[]> {
  const [lv, md] = await Promise.all([
    db.from("cc_levels").select("id,module_id,level_number,title_en,title_ar"),
    db.from("cc_modules").select("id,title_en,title_ar,sort,competition_module"),
  ]);
  const mods = new Map(((md.data ?? []) as Pick<CcModule, "id" | "title_en" | "title_ar" | "sort" | "competition_module">[]).map((m) => [m.id, m]));
  return ((lv.data ?? []) as Pick<CcLevel, "id" | "module_id" | "level_number" | "title_en" | "title_ar">[])
    .map((l) => {
      const m = mods.get(l.module_id);
      return {
        id: l.id,
        moduleId: l.module_id,
        moduleTitle_en: m?.title_en ?? "",
        moduleTitle_ar: m?.title_ar ?? "",
        moduleSort: m?.sort ?? 0,
        competition_module: m?.competition_module ?? null,
        level_number: Number(l.level_number),
        title_en: l.title_en,
        title_ar: l.title_ar,
      };
    })
    .sort((a, b) => a.moduleSort - b.moduleSort || a.moduleTitle_en.localeCompare(b.moduleTitle_en) || a.level_number - b.level_number);
}

export type ExerciseListRow = Pick<
  CcExercise,
  "id" | "slug" | "sort" | "level_id" | "title_en" | "title_ar" | "is_published" | "is_free_sample" | "grading_mode" | "max_points" | "competition_module" | "expected_upload"
> & { hasReference: boolean };

export async function loadExerciseList(): Promise<Loaded<{ rows: ExerciseListRow[]; levels: LevelOption[] }>> {
  const db = adminDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    const r = await db
      .from("cc_exercises")
      .select("id,slug,sort,level_id,title_en,title_ar,is_published,is_free_sample,grading_mode,max_points,competition_module,expected_upload,reference_data")
      .order("sort", { ascending: true });
    if (r.error) return fail(r.error.code);
    const rows = ((r.data ?? []) as (ExerciseListRow & { reference_data: unknown })[]).map(({ reference_data, ...rest }) => ({
      ...rest,
      hasReference: !!reference_data && typeof reference_data === "object" && Object.keys(reference_data as object).length > 0,
    }));
    return { ok: true, rows, levels: await levelOptions(db) };
  } catch (e) {
    console.error("[cc-admin-exercises] list failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export interface ExerciseEditorData {
  exercise: CcExercise | null;
  aspects: CcTaskAspect[];
  levels: LevelOption[];
  skills: SkillOption[];
  modules: ModuleOption[];
  graderReady: boolean;
  checks: PublishCheckResult | null;
}

/** slug null = a new exercise (levels and labels only). */
export async function loadExerciseEditor(slug: string | null): Promise<Loaded<ExerciseEditorData>> {
  const db = adminDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    let exercise: CcExercise | null = null;
    let aspects: CcTaskAspect[] = [];
    if (slug) {
      const e = await db.from("cc_exercises").select("*").eq("slug", slug).maybeSingle<CcExercise>();
      if (e.error) return fail(e.error.code);
      if (!e.data) return { ok: false, reason: "not_found" };
      exercise = e.data;
      const a = await db.from("cc_task_aspects").select("*").eq("exercise_id", exercise.id).order("position", { ascending: true });
      if (a.error) return fail(a.error.code);
      aspects = (a.data ?? []) as CcTaskAspect[];
    }
    const [levels, l] = await Promise.all([levelOptions(db), labels(db)]);
    return {
      ok: true,
      exercise,
      aspects,
      levels,
      ...l,
      graderReady: graderConfigured(),
      checks: exercise ? exercisePublishChecks({ exercise, aspects }) : null,
    };
  } catch (e) {
    console.error("[cc-admin-exercises] editor load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
