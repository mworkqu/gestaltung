// Admin insights data — SERVER ONLY (Prompt 11 Step E). The CALLER checks the
// role first (the Insights page and the pilot report route are admin only).
//
//   loadInsights(range) -> InsightsData (insights.ts) + display labels
//
// Reads only the columns it needs (service client, RLS bypassed), pages with
// fetchAllRows (PostgREST caps responses at 1,000 rows) and chunks `in` lists.
// Each section is loaded on its own: a failing query leaves that section null
// and the rest of the page still shows. The result holds NO names or contact
// details: institutions and study levels come as plain labels only.

import { fetchAllRows } from "@/lib/supabase/fetch-all";

import { loadReviewQueue } from "../drawing/review-server";
import {
  moduleReadiness,
  scoreAttempt,
  type AspectInput,
  type AspectResultInput,
  type TaskInput,
  type TaskResultInput,
} from "../scoring/core";
import {
  buildFunnel,
  getReadyStops,
  qatarDay,
  qatarDayStartIso,
  type InsightRange,
  type JourneyRow,
} from "./funnel";
import {
  averageReviewHours,
  distribution,
  improvementStats,
  moduleAverages,
  skillAverages,
  summariseAiUsage,
  summariseGrading,
  type InsightsData,
} from "./insights";
import { adminDb, isMissingSchema } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/insights-server.ts is server-only");

type Db = NonNullable<ReturnType<typeof adminDb>>;
type PgError = { code?: string; message?: string } | null;
type Row = Record<string, unknown>;

export interface InsightLabels {
  skills: { id: number; en: string; ar: string }[];
  modules: { code: string; en: string; ar: string }[];
}

export type InsightsLoad =
  | { ok: true; data: InsightsData; labels: InsightLabels; partial: boolean }
  | { ok: false; reason: "unavailable" | "not_set_up" | "error" };

const IN_CHUNK = 100;
/** Most recent graded attempts used for the module readiness (keeps the page fast). */
const MODULE_ATTEMPT_CAP = 1500;

function logFail(label: string, error: PgError | unknown) {
  const e = error as PgError;
  if (e && typeof e === "object" && "code" in e && isMissingSchema(e.code)) return;
  console.error(`[cc-insights] ${label} failed:`, e && typeof e === "object" ? ((e as PgError)?.code ?? (e as PgError)?.message) : "unknown");
}

/** Runs a query per chunk of ids (each page-capped read is paged), concatenating the rows. */
async function inChunks<T>(
  ids: readonly string[],
  run: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: PgError }>,
  size = IN_CHUNK,
): Promise<{ rows: T[]; error: PgError }> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const res = await fetchAllRows<T>((from, to) => run(chunk, from, to));
    if (res.error) return { rows: [], error: res.error };
    rows.push(...res.rows);
  }
  return { rows, error: null };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export async function loadInsights(range: InsightRange): Promise<InsightsLoad> {
  const db = adminDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    const probe = await db.from("cc_profiles").select("id", { count: "exact", head: true });
    if (probe.error) return { ok: false, reason: isMissingSchema(probe.error.code) ? "not_set_up" : "error" };
  } catch {
    return { ok: false, reason: "error" };
  }

  let partial = false;
  const guarded = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      partial = true;
      logFail(label, e);
      return null;
    }
  };

  const [people, journeys, tests, labels] = await Promise.all([
    guarded("profiles", () => loadStudents(db, range)),
    guarded("journeys", () => loadJourneys(db, range)),
    guarded("tests", () => loadTests(db)),
    guarded("labels", () => loadLabels(db)),
  ]);

  // Funnel + Get Ready stops (journeys restricted to student profiles when we have them).
  const studentIds = people ? new Set(people.map((p) => p.id)) : null;
  const rows = journeys ? (studentIds ? journeys.filter((j) => studentIds.has(j.user_id)) : journeys) : null;
  const funnel = rows ? buildFunnel(rows, { from: range.from, to: range.to }) : null;
  const stops = rows
    ? await guarded("get-ready steps", async () => {
        const unfinished = rows.filter((j) => !j.get_ready_completed_at).map((j) => j.user_id);
        const { rows: steps, error } = await inChunks<{ user_id: string; step_key: string }>(unfinished, (chunk, from, to) =>
          db.from("cc_get_ready_steps").select("user_id,step_key").in("user_id", chunk).order("user_id").order("step_key").range(from, to),
        );
        if (error) throw error;
        const done = new Map<string, string[]>(unfinished.map((id) => [id, []]));
        for (const s of steps) done.get(s.user_id)?.push(s.step_key);
        return { stuck: unfinished.length, stops: getReadyStops([...done.values()].map((doneKeys) => ({ doneKeys }))) };
      })
    : null;

  // Graded attempts in the range (non-practice, non-admin-only tests).
  const eligibleTests = tests ? new Map([...tests].filter(([, t]) => !t.admin_only && t.type !== "practice")) : null;
  const attempts = eligibleTests
    ? await guarded("attempts", async () => {
        const { rows: a, error } = await fetchAllRows<{ id: string; user_id: string; test_id: string; percent: number | string | null; started_at: string; submitted_at: string | null }>((from, to) =>
          db
            .from("cc_attempts")
            .select("id,user_id,test_id,percent,started_at,submitted_at")
            .eq("status", "graded")
            .not("percent", "is", null)
            .gte("started_at", range.fromIso)
            .lt("started_at", range.toIso)
            .order("id")
            .range(from, to),
        );
        if (error) throw error;
        return a.filter((x) => eligibleTests.has(x.test_id));
      })
    : null;

  const improvement = attempts ? improvementStats(attempts.map((a) => ({ userId: a.user_id, percent: a.percent, at: a.submitted_at ?? a.started_at }))) : null;

  // Skills: assessed skill scores of diagnostic attempts.
  const diagnosticIds = attempts && tests ? attempts.filter((a) => tests.get(a.test_id)?.type === "diagnostic").map((a) => a.id) : null;
  const skills = diagnosticIds
    ? await guarded("skill scores", async () => {
        const { rows: s, error } = await inChunks<{ skill_area_id: number; percent: number | string | null; assessed: boolean | null }>(diagnosticIds, (chunk, from, to) =>
          db.from("cc_skill_scores").select("attempt_id,skill_area_id,percent,assessed").in("attempt_id", chunk).eq("assessed", true).order("attempt_id").order("skill_area_id").range(from, to),
        );
        if (error) throw error;
        return skillAverages(s);
      })
    : null;

  const modules = attempts
    ? await guarded("module readiness", () => loadModuleReadiness(db, attempts))
    : null;

  const health = await guarded("grading health", () => loadHealth(db, range));

  const data: InsightsData = {
    range: { from: range.from, to: range.to },
    students: people ? people.length : null,
    funnel,
    stuckInGetReady: stops ? stops.stuck : null,
    getReadyStops: stops ? stops.stops : null,
    skills,
    skillAttempts: diagnosticIds ? diagnosticIds.length : 0,
    modules: modules ? modules.averages : null,
    moduleAttempts: modules ? modules.attempts : 0,
    improvement,
    institutions: people ? distribution(people.map((p) => p.institution)) : null,
    studyLevels: people ? distribution(people.map((p) => p.studyLevel)) : null,
    health,
  };
  const anyNull = [funnel, stops, skills, modules, improvement, health, people].some((x) => x == null);
  return { ok: true, data, labels: labels ?? { skills: [], modules: [] }, partial: partial || anyNull };
}

// ─── sections ─────────────────────────────────────────────────────────────

async function loadStudents(db: Db, range: InsightRange) {
  const { rows, error } = await fetchAllRows<Row>((from, to) =>
    db
      .from("cc_profiles")
      .select("id,institution,institution_other,study_level")
      .eq("role", "student")
      .gte("created_at", range.fromIso)
      .lt("created_at", range.toIso)
      .order("id")
      .range(from, to),
  );
  if (error) throw error;
  return rows.map((r) => {
    const inst = str(r.institution);
    const other = str(r.institution_other);
    return {
      id: String(r.id),
      institution: inst && inst.toLowerCase() !== "other" ? inst : (other ?? inst),
      studyLevel: str(r.study_level),
    };
  });
}

async function loadJourneys(db: Db, range: InsightRange): Promise<(JourneyRow & { user_id: string })[]> {
  const { rows, error } = await fetchAllRows<JourneyRow & { user_id: string }>((from, to) =>
    db
      .from("cc_journey_progress")
      .select("user_id,created_at,get_ready_completed_at,practice_passed_at,first_test_submitted_at,results_viewed_at,sample_lesson_watched_at,enrolled_at")
      .gte("created_at", range.fromIso)
      .lt("created_at", range.toIso)
      .order("user_id")
      .range(from, to),
  );
  if (error) throw error;
  return rows;
}

async function loadTests(db: Db): Promise<Map<string, { type: string; admin_only: boolean }>> {
  const { rows, error } = await fetchAllRows<{ id: string; type: string; admin_only: boolean | null }>((from, to) =>
    db.from("cc_tests").select("id,type,admin_only").order("id").range(from, to),
  );
  if (error) throw error;
  return new Map(rows.map((t) => [t.id, { type: t.type, admin_only: !!t.admin_only }]));
}

async function loadLabels(db: Db): Promise<InsightLabels> {
  const [skills, modules] = await Promise.all([
    db.from("cc_skill_areas").select("id,name_en,name_ar").order("id"),
    db.from("cc_competition_modules").select("code,name_en,name_ar").order("position"),
  ]);
  return {
    skills: ((skills.data ?? []) as { id: number; name_en: string; name_ar: string }[]).map((s) => ({ id: Number(s.id), en: s.name_en, ar: s.name_ar })),
    modules: ((modules.data ?? []) as { code: string; name_en: string; name_ar: string }[]).map((m) => ({ code: m.code, en: m.name_en, ar: m.name_ar })),
  };
}

/** Per-attempt competition module readiness (reuses scoring/core.ts), averaged. */
async function loadModuleReadiness(db: Db, all: readonly { id: string; test_id: string; started_at: string }[]) {
  const attempts = [...all].sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, MODULE_ATTEMPT_CAP);
  if (attempts.length === 0) return { averages: moduleAverages([]), attempts: 0 };
  const testIds = [...new Set(attempts.map((a) => a.test_id))];

  const tasksRes = await inChunks<TaskInput & { id: string; test_id: string }>(testIds, (chunk, from, to) =>
    db.from("cc_test_tasks").select("id,test_id,skill_area_id,competition_module,max_points,grading_mode").in("test_id", chunk).order("id").range(from, to),
  );
  if (tasksRes.error) throw tasksRes.error;
  const tasksByTest = new Map<string, (TaskInput & { test_id: string })[]>();
  for (const t of tasksRes.rows) {
    const list = tasksByTest.get(t.test_id) ?? [];
    list.push(t);
    tasksByTest.set(t.test_id, list);
  }

  const aspectsRes = await inChunks<AspectInput>(
    tasksRes.rows.map((t) => t.id),
    (chunk, from, to) =>
      db.from("cc_task_aspects").select("id,task_id,skill_area_id,competition_module,type,max_points,partial_rule").in("task_id", chunk).order("id").range(from, to),
  );
  if (aspectsRes.error) throw aspectsRes.error;

  const resultsRes = await inChunks<TaskResultInput & { id: string; attempt_id: string }>(
    attempts.map((a) => a.id),
    (chunk, from, to) =>
      db
        .from("cc_task_results")
        .select("id,attempt_id,task_id,status,submission_id,final_score,manual_score,ai_score,auto_score,needs_manual_review")
        .in("attempt_id", chunk)
        .order("id")
        .range(from, to),
    50,
  );
  if (resultsRes.error) throw resultsRes.error;
  const resultsByAttempt = new Map<string, (TaskResultInput & { id: string })[]>();
  const attemptOfResult = new Map<string, string>();
  for (const r of resultsRes.rows) {
    const list = resultsByAttempt.get(r.attempt_id) ?? [];
    list.push(r);
    resultsByAttempt.set(r.attempt_id, list);
    attemptOfResult.set(r.id, r.attempt_id);
  }

  const arRes = await inChunks<AspectResultInput & { task_result_id: string }>(
    resultsRes.rows.map((r) => r.id),
    (chunk, from, to) =>
      db.from("cc_aspect_results").select("id,task_result_id,aspect_id,passed,judgement_score,points_awarded").in("task_result_id", chunk).order("id").range(from, to),
  );
  if (arRes.error) throw arRes.error;
  const aspectResultsByAttempt = new Map<string, AspectResultInput[]>();
  for (const ar of arRes.rows) {
    const attemptId = attemptOfResult.get(ar.task_result_id);
    if (!attemptId) continue;
    const list = aspectResultsByAttempt.get(attemptId) ?? [];
    list.push(ar);
    aspectResultsByAttempt.set(attemptId, list);
  }

  const aspects = aspectsRes.rows;
  const perAttempt = attempts.map((a) => {
    const tasks = tasksByTest.get(a.test_id) ?? [];
    const scores = scoreAttempt({
      tasks,
      aspects,
      aspectResults: aspectResultsByAttempt.get(a.id) ?? [],
      results: resultsByAttempt.get(a.id) ?? [],
    });
    return moduleReadiness(scores.units);
  });
  return { averages: moduleAverages(perAttempt), attempts: attempts.length };
}

async function loadHealth(db: Db, range: InsightRange): Promise<NonNullable<InsightsData["health"]>> {
  const today = qatarDay(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;

  const [stepLogs, aiLogs, reviewed, queue] = await Promise.all([
    fetchAllRows<{ duration_ms: number | null; error_code: string | null; error: string | null }>((from, to) =>
      db
        .from("cc_grading_logs")
        .select("id,duration_ms,error_code,error")
        .eq("kind", "step")
        .gte("created_at", range.fromIso)
        .lt("created_at", range.toIso)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{ kind: string; cost_estimate: number | string | null }>((from, to) =>
      db
        .from("cc_grading_logs")
        .select("id,kind,cost_estimate")
        .in("kind", ["ai_drawing", "ai_translate"])
        .gte("created_at", qatarDayStartIso(monthStart))
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{ created_at: string; graded_at: string | null }>((from, to) =>
      db
        .from("cc_task_results")
        .select("id,created_at,graded_at")
        .not("graded_by", "is", null)
        .gte("graded_at", range.fromIso)
        .lt("graded_at", range.toIso)
        .order("id")
        .range(from, to),
    ),
    loadReviewQueue("en").catch(() => null),
  ]);
  if (stepLogs.error) throw stepLogs.error;
  if (aiLogs.error) throw aiLogs.error;
  if (reviewed.error) throw reviewed.error;
  const review = averageReviewHours(reviewed.rows);
  return {
    grading: summariseGrading(stepLogs.rows),
    ai: summariseAiUsage(aiLogs.rows),
    aiMonthStart: monthStart,
    backlog: queue && queue.ok ? queue.rows.length : null,
    reviewed: review.count,
    avgReviewHours: review.avgHours,
  };
}
