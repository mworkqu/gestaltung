// Test flow data — SERVER ONLY. Reads go through the signed-in user's RLS
// client (students see published, non-admin-only tests and their own
// attempts; staff see everything). Attempts and submissions are WRITTEN with
// the service role after the caller has checked the session (actions.ts).
// Everything degrades gracefully before migration 0077 / 0080 has run.

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import type { CcUser } from "../auth/server";
import type {
  CcAttempt,
  CcCompetitionModule,
  CcJourneyProgress,
  CcSkillArea,
  CcSubmission,
  CcTest,
  CcTestTaskPublic,
} from "../db/types";
import { enqueueGrading } from "../grader/queue";
import { readGetReadySteps } from "../get-ready/server";
import { getReadyGate, type GetReadyGate } from "../get-ready/steps";
import { markJourney } from "../journey/server";
import { DEFAULT_GRACE_SECONDS, isPastGrace, parseTime } from "./timer";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/test/server.ts is server-only");

/** Test types listed on /test (practice and exercises live elsewhere). */
export const LISTED_TEST_TYPES = ["diagnostic", "mock", "qualifier"] as const;

export const SUBMISSIONS_BUCKET = "cc-submissions";
export const TASK_FILES_BUCKET = "cc-task-files";

export type LoadFailure = { ok: false; reason: "not_found" | "not_set_up" | "error" };

function isMissingTable(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

function failure(where: string, error: { code?: string; message?: string }): LoadFailure {
  if (isMissingTable(error.code)) return { ok: false, reason: "not_set_up" };
  console.error(`[cc-test] ${where} failed:`, error.code ?? error.message);
  return { ok: false, reason: "error" };
}

export type TestSummary = Pick<
  CcTest,
  | "id"
  | "slug"
  | "title_en"
  | "title_ar"
  | "type"
  | "time_limit_minutes"
  | "is_published"
  | "admin_only"
  | "upload_mode"
  | "retake_cooldown_days"
  | "grace_seconds"
>;

const SUMMARY_COLUMNS =
  "id,slug,title_en,title_ar,type,time_limit_minutes,is_published,admin_only,upload_mode,retake_cooldown_days,grace_seconds";

/** Tests the user may see on /test (RLS decides; staff also see unpublished and staff-only tests). */
export async function listTests(): Promise<{ ok: true; tests: TestSummary[] } | LoadFailure> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cc_tests")
      .select(SUMMARY_COLUMNS)
      .in("type", [...LISTED_TEST_TYPES])
      .order("created_at", { ascending: true });
    if (error) return failure("list", error);
    return { ok: true, tests: (data ?? []) as TestSummary[] };
  } catch (e) {
    console.error("[cc-test] list failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export type LoadedTest = { ok: true; test: CcTest; tasks: CcTestTaskPublic[] };

/** One test and its public task rows (no answers). */
export async function loadTest(slug: string): Promise<LoadedTest | LoadFailure> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return { ok: false, reason: "not_found" };
  try {
    const supabase = await createClient();
    const { data: test, error } = await supabase.from("cc_tests").select("*").eq("slug", slug).maybeSingle<CcTest>();
    if (error) return failure("test read", error);
    if (!test) return { ok: false, reason: "not_found" };
    const { data: tasks, error: tErr } = await supabase
      .from("cc_test_tasks_public")
      .select("*")
      .eq("test_id", test.id)
      .order("position", { ascending: true });
    if (tErr) return failure("task read", tErr);
    return { ok: true, test, tasks: (tasks ?? []) as CcTestTaskPublic[] };
  } catch (e) {
    console.error("[cc-test] load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

export type AttemptRow = Pick<
  CcAttempt,
  "id" | "user_id" | "test_id" | "status" | "started_at" | "deadline_at" | "submitted_at" | "submit_reason" | "in_person" | "phase_markers"
>;

const ATTEMPT_COLUMNS = "id,user_id,test_id,status,started_at,deadline_at,submitted_at,submit_reason,in_person,phase_markers";

/** The user's attempts at one test, newest first (RLS: own rows). */
export async function loadAttempts(userId: string, testId: string): Promise<AttemptRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cc_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("user_id", userId)
      .eq("test_id", testId)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) {
      if (!isMissingTable(error.code)) console.error("[cc-test] attempts read failed:", error.code ?? error.message);
      return [];
    }
    return (data ?? []) as AttemptRow[];
  } catch (e) {
    console.error("[cc-test] attempts read failed:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

/** Latest attempt per test for the /test list (RLS: own rows). */
export async function loadLatestAttempts(userId: string, testIds: string[]): Promise<Map<string, AttemptRow>> {
  const out = new Map<string, AttemptRow>();
  if (testIds.length === 0) return out;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cc_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("user_id", userId)
      .in("test_id", testIds)
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) return out;
    for (const a of (data ?? []) as AttemptRow[]) if (!out.has(a.test_id)) out.set(a.test_id, a);
  } catch {
    // list still renders without statuses
  }
  return out;
}

/** One attempt owned by `userId`, read with the service role (null when not theirs). */
export async function loadOwnAttempt(attemptId: string, userId: string): Promise<AttemptRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  const service = createServiceClient();
  if (!service) return null;
  const { data, error } = await service
    .from("cc_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle<AttemptRow>();
  if (error) {
    console.error("[cc-test] attempt read failed:", error.code ?? error.message);
    return null;
  }
  return data ?? null;
}

/** Any attempt by id (service role) — staff tools only; check the role first. */
export async function loadAttemptById(attemptId: string): Promise<AttemptRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  const service = createServiceClient();
  if (!service) return null;
  const { data } = await service.from("cc_attempts").select(ATTEMPT_COLUMNS).eq("id", attemptId).maybeSingle<AttemptRow>();
  return data ?? null;
}

export type SubmissionRow = Pick<
  CcSubmission,
  "id" | "task_id" | "file_name" | "file_size" | "uploaded_at" | "replaced_count" | "package_manifest"
>;

/** Files of one attempt (RLS: own rows; staff all). */
export async function loadSubmissions(attemptId: string): Promise<SubmissionRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cc_submissions")
      .select("id,task_id,file_name,file_size,uploaded_at,replaced_count,package_manifest")
      .eq("attempt_id", attemptId);
    if (error) return [];
    return (data ?? []) as SubmissionRow[];
  } catch {
    return [];
  }
}

/** Skill areas and competition modules for chips (readable by anyone). */
export async function loadLabels(): Promise<{
  skills: Map<number, Pick<CcSkillArea, "id" | "name_en" | "name_ar">>;
  modules: Map<string, Pick<CcCompetitionModule, "code" | "name_en" | "name_ar" | "hours">>;
}> {
  const skills = new Map<number, Pick<CcSkillArea, "id" | "name_en" | "name_ar">>();
  const modules = new Map<string, Pick<CcCompetitionModule, "code" | "name_en" | "name_ar" | "hours">>();
  try {
    const supabase = await createClient();
    const [s, m] = await Promise.all([
      supabase.from("cc_skill_areas").select("id,name_en,name_ar"),
      supabase.from("cc_competition_modules").select("code,name_en,name_ar,hours"),
    ]);
    for (const r of (s.data ?? []) as Pick<CcSkillArea, "id" | "name_en" | "name_ar">[]) skills.set(Number(r.id), r);
    for (const r of (m.data ?? []) as Pick<CcCompetitionModule, "code" | "name_en" | "name_ar" | "hours">[]) modules.set(r.code, r);
  } catch {
    // chips fall back to the code
  }
  return { skills, modules };
}

/** Get Ready gate for the Start button (profile bypass, journey stamp or the step rows). */
export async function readGate(cc: CcUser): Promise<GetReadyGate> {
  let journey: Pick<CcJourneyProgress, "get_ready_completed_at"> | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cc_journey_progress")
      .select("get_ready_completed_at")
      .eq("user_id", cc.user.id)
      .maybeSingle<Pick<CcJourneyProgress, "get_ready_completed_at">>();
    journey = data ?? null;
  } catch {
    journey = null;
  }
  const steps = await readGetReadySteps(cc.user.id);
  return getReadyGate(cc.profile, journey, steps.ok ? steps.keys : undefined);
}

/** Client IP and user agent of the current request (for integrity, admin-only). */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || h.get("x-real-ip") || null;
    const ua = h.get("user-agent");
    return { ip: ip ? ip.slice(0, 64) : null, userAgent: ua ? ua.slice(0, 400) : null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Closes an in-progress attempt (manual / timeout / admin): sets
 * submitted_at, submit_reason, status 'submitted' (only while still
 * in_progress, so two closes never race), then queues grading and stamps the
 * journey. Returns true when THIS call closed it.
 */
export async function finalizeAttempt(
  attempt: Pick<AttemptRow, "id" | "user_id">,
  reason: "manual" | "timeout" | "admin",
  meta: { ip: string | null; userAgent: string | null } | null,
  testType: string
): Promise<boolean> {
  const service = createServiceClient();
  if (!service) return false;
  const { data, error } = await service
    .from("cc_attempts")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submit_reason: reason,
      submit_ip: meta?.ip ?? null,
      submit_user_agent: meta?.userAgent ?? null,
    })
    .eq("id", attempt.id)
    .eq("status", "in_progress")
    .select("id");
  if (error) {
    console.error("[cc-test] submit failed:", error.code ?? error.message);
    return false;
  }
  if (!data || data.length === 0) return false;
  await enqueueGrading(attempt.id);
  if (testType !== "practice" && testType !== "exercise") await markJourney(attempt.user_id, "first_test_submitted_at");
  return true;
}

/**
 * The server-side half of auto-submit: called on every attempt read. An
 * attempt still in progress after deadline + grace is closed with reason
 * "timeout". Returns the attempt as it is now.
 */
export async function closeIfExpired<T extends Pick<AttemptRow, "id" | "user_id" | "status" | "deadline_at">>(
  attempt: T,
  test: { grace_seconds?: number | null; type: string },
  now: number = Date.now()
): Promise<T> {
  if (attempt.status !== "in_progress") return attempt;
  if (!isPastGrace(now, parseTime(attempt.deadline_at), test.grace_seconds ?? DEFAULT_GRACE_SECONDS)) return attempt;
  await finalizeAttempt(attempt, "timeout", null, test.type);
  return { ...attempt, status: "grading" };
}

/** Grading rows of one attempt (RLS: own rows; staff all). */
export async function loadTaskResults(attemptId: string): Promise<{ task_id: string; status: string; submission_id: string | null }[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("cc_task_results").select("task_id,status,submission_id").eq("attempt_id", attemptId);
    if (error) return [];
    return (data ?? []) as { task_id: string; status: string; submission_id: string | null }[];
  } catch {
    return [];
  }
}
