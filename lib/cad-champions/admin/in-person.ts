// In-person sessions (COMPETITION_ALIGNMENT G, Prompt 11 "Task 11"): an admin
// starts a module_package test for a group of students in the studio. Each
// student gets a normal cc_attempts row (same started_at / deadline_at as
// startAttemptAction) with in_person = true and ONE shared session_id per
// group. The normal start rules still apply and are never bypassed silently:
// a student with an attempt in progress, in the retake cooldown or without
// Get Ready done is SKIPPED and reported back with the reason.
//
// No server-only imports: the DB work goes through a small store interface
// (supabaseInPersonStore wraps the service client), so the whole flow is
// unit-tested with a fake store (in-person.test.ts). The CALLER checks the
// admin role first (adminGuard("admin")).

import type { CcTestType } from "../db/types";
import { getReadyGate } from "../get-ready/steps";
import { introState, type AttemptLite } from "../test/status";
import { DEFAULT_GRACE_SECONDS, deadlineFrom, isPastGrace, parseTime } from "../test/timer";
import type { AdminDb } from "./server";
import { isUuid } from "./student-detail";

/** Most students one session can start at once (a studio room). */
export const IN_PERSON_MAX_STUDENTS = 40;

export interface InPersonTestRow {
  id: string;
  slug: string;
  title_en: string;
  title_ar: string;
  type: CcTestType | string;
  upload_mode: string;
  is_published: boolean;
  admin_only: boolean;
  time_limit_minutes: number | null;
  retake_cooldown_days: number;
  grace_seconds: number | null;
}

/** A test an admin may run in person: module_package mode, published or admin-only (studio use). */
export function isInPersonEligible(t: Pick<InPersonTestRow, "upload_mode" | "is_published" | "admin_only">): boolean {
  return t.upload_mode === "module_package" && (t.is_published || t.admin_only);
}

export type InPersonSkipReason = "not_found" | "in_progress" | "cooldown" | "get_ready" | "error";

export interface InPersonStudentState {
  id: string;
  /** cc_profiles row exists and role = student. */
  isStudent: boolean;
  getReadyBypass: boolean;
  getReadyCompletedAt: string | null;
  stepsDone: string[];
  attempts: AttemptLite[];
}

/** Which students may start now, and why the others are skipped (pure; uses the same introState as the student's own Start button). */
export function planInPersonStarts(
  students: readonly InPersonStudentState[],
  test: Pick<InPersonTestRow, "type" | "retake_cooldown_days" | "grace_seconds">,
  now: number,
): { start: string[]; skipped: { studentId: string; reason: InPersonSkipReason }[] } {
  const start: string[] = [];
  const skipped: { studentId: string; reason: InPersonSkipReason }[] = [];
  for (const s of students) {
    if (!s.isStudent) {
      skipped.push({ studentId: s.id, reason: "not_found" });
      continue;
    }
    const gate = getReadyGate({ get_ready_bypass: s.getReadyBypass }, { get_ready_completed_at: s.getReadyCompletedAt }, s.stepsDone);
    const state = introState({
      attempts: s.attempts,
      testType: test.type,
      cooldownDays: test.retake_cooldown_days,
      graceSeconds: test.grace_seconds ?? DEFAULT_GRACE_SECONDS,
      gate,
      isStaff: false,
      now,
    });
    if (state.kind === "continue") skipped.push({ studentId: s.id, reason: "in_progress" });
    else if (state.kind === "cooldown") skipped.push({ studentId: s.id, reason: "cooldown" });
    else if (state.kind === "locked") skipped.push({ studentId: s.id, reason: "get_ready" });
    else start.push(s.id);
  }
  return { start, skipped };
}

/** Distinct valid uuids, in order. */
export function cleanStudentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (isUuid(v) && !out.includes(v.toLowerCase())) out.push(v.toLowerCase());
  return out;
}

// ------------------------------------------------------------------ store

type AttemptRowLite = AttemptLite & { user_id: string };

export interface InPersonStore {
  loadTest(testId: string): Promise<{ ok: true; test: InPersonTestRow | null } | { ok: false; code: string | null }>;
  taskCount(testId: string): Promise<number>;
  loadStudents(ids: string[]): Promise<{
    profiles: { id: string; role: string; get_ready_bypass: boolean }[];
    journey: { user_id: string; get_ready_completed_at: string | null }[];
    steps: { user_id: string; step_key: string }[];
  }>;
  loadAttempts(testId: string, userIds: string[]): Promise<AttemptRowLite[]>;
  /** Closes an in-progress attempt that is past deadline + grace (the normal timeout path). */
  closeExpired?(attempt: AttemptRowLite, testType: string): Promise<void>;
  insertAttempt(row: Record<string, unknown>): Promise<{ id: string } | { error: string }>;
  audit(entry: { actorId: string; testId: string; after: unknown }): Promise<void>;
}

export type InPersonStartResult =
  | {
      ok: true;
      sessionId: string;
      startedAt: string;
      deadlineAt: string | null;
      started: { studentId: string; attemptId: string }[];
      skipped: { studentId: string; reason: InPersonSkipReason }[];
    }
  | { ok: false; error: "invalid" | "not_found" | "not_set_up" | "error"; detail?: "no_students" | "too_many" | "not_package" | "no_tasks" };

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);

/** The flow with an injected store (tested). */
export async function runInPersonStart(
  store: InPersonStore,
  input: { testId: string; studentIds: unknown; actorId: string; now?: number; sessionId?: string },
): Promise<InPersonStartResult> {
  if (!isUuid(input.testId)) return { ok: false, error: "invalid" };
  const ids = cleanStudentIds(input.studentIds);
  if (ids.length === 0) return { ok: false, error: "invalid", detail: "no_students" };
  if (ids.length > IN_PERSON_MAX_STUDENTS) return { ok: false, error: "invalid", detail: "too_many" };

  try {
    const loaded = await store.loadTest(input.testId);
    if (!loaded.ok) return { ok: false, error: loaded.code && MISSING.has(loaded.code) ? "not_set_up" : "error" };
    const test = loaded.test;
    if (!test) return { ok: false, error: "not_found" };
    if (!isInPersonEligible(test)) return { ok: false, error: "invalid", detail: "not_package" };
    if ((await store.taskCount(test.id)) === 0) return { ok: false, error: "invalid", detail: "no_tasks" };

    const now = input.now ?? Date.now();
    const grace = test.grace_seconds ?? DEFAULT_GRACE_SECONDS;
    const [people, attempts] = await Promise.all([store.loadStudents(ids), store.loadAttempts(test.id, ids)]);

    // Expired attempts still marked in_progress are closed the normal way first
    // (otherwise the one-active-attempt index would block the new start).
    const current: AttemptRowLite[] = [];
    for (const a of attempts) {
      if (a.status === "in_progress" && isPastGrace(now, parseTime(a.deadline_at), grace) && store.closeExpired) {
        await store.closeExpired(a, String(test.type));
        current.push({ ...a, status: "submitted", submitted_at: a.deadline_at });
      } else current.push(a);
    }

    const profile = new Map(people.profiles.map((p) => [p.id, p]));
    const journey = new Map(people.journey.map((j) => [j.user_id, j.get_ready_completed_at]));
    const states: InPersonStudentState[] = ids.map((id) => {
      const p = profile.get(id);
      return {
        id,
        isStudent: !!p && p.role === "student",
        getReadyBypass: !!p?.get_ready_bypass,
        getReadyCompletedAt: journey.get(id) ?? null,
        stepsDone: people.steps.filter((s) => s.user_id === id).map((s) => s.step_key),
        attempts: current.filter((a) => a.user_id === id),
      };
    });
    const plan = planInPersonStarts(states, test, now);

    const sessionId = input.sessionId ?? crypto.randomUUID();
    const startedAt = new Date(now).toISOString();
    const deadline = deadlineFrom(now, test.time_limit_minutes);
    const deadlineAt = deadline == null ? null : new Date(deadline).toISOString();
    const started: { studentId: string; attemptId: string }[] = [];
    const skipped = [...plan.skipped];
    for (const studentId of plan.start) {
      const res = await store.insertAttempt({
        user_id: studentId,
        test_id: test.id,
        started_at: startedAt,
        deadline_at: deadlineAt,
        status: "in_progress",
        in_person: true,
        session_id: sessionId,
        // The trainer's machine started it: no student IP / user agent.
        start_ip: null,
        start_user_agent: null,
      });
      if ("id" in res) started.push({ studentId, attemptId: res.id });
      else skipped.push({ studentId, reason: res.error === "23505" ? "in_progress" : "error" });
    }

    if (started.length > 0 || skipped.length > 0) {
      await store.audit({
        actorId: input.actorId,
        testId: test.id,
        after: { session_id: sessionId, test_slug: test.slug, started_at: startedAt, deadline_at: deadlineAt, started, skipped },
      });
    }
    return { ok: true, sessionId, startedAt, deadlineAt, started, skipped };
  } catch (e) {
    console.error("[cc-admin] in-person start failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}

const TEST_COLUMNS = "id,slug,title_en,title_ar,type,upload_mode,is_published,admin_only,time_limit_minutes,retake_cooldown_days,grace_seconds";

/** The service-client store. */
export function supabaseInPersonStore(db: AdminDb, closeExpired?: InPersonStore["closeExpired"]): InPersonStore {
  return {
    async loadTest(testId) {
      const { data, error } = await db.from("cc_tests").select(TEST_COLUMNS).eq("id", testId).maybeSingle<InPersonTestRow>();
      if (error) return { ok: false, code: error.code ?? null };
      return { ok: true, test: data ?? null };
    },
    async taskCount(testId) {
      const { count } = await db.from("cc_test_tasks").select("id", { count: "exact", head: true }).eq("test_id", testId);
      return count ?? 0;
    },
    async loadStudents(ids) {
      const [p, j, s] = await Promise.all([
        db.from("cc_profiles").select("id,role,get_ready_bypass").in("id", ids),
        db.from("cc_journey_progress").select("user_id,get_ready_completed_at").in("user_id", ids),
        db.from("cc_get_ready_steps").select("user_id,step_key").in("user_id", ids),
      ]);
      return {
        profiles: (p.data ?? []) as { id: string; role: string; get_ready_bypass: boolean }[],
        journey: (j.data ?? []) as { user_id: string; get_ready_completed_at: string | null }[],
        steps: (s.data ?? []) as { user_id: string; step_key: string }[],
      };
    },
    async loadAttempts(testId, userIds) {
      const { data } = await db
        .from("cc_attempts")
        .select("id,user_id,status,started_at,deadline_at,submitted_at")
        .eq("test_id", testId)
        .in("user_id", userIds)
        .order("started_at", { ascending: false })
        .limit(1000);
      return (data ?? []) as AttemptRowLite[];
    },
    closeExpired,
    async insertAttempt(row) {
      const { data, error } = await db.from("cc_attempts").insert(row).select("id").maybeSingle<{ id: string }>();
      if (error) {
        if (error.code !== "23505") console.error("[cc-admin] in-person insert failed:", error.code ?? error.message);
        return { error: error.code ?? "error" };
      }
      return data ? { id: data.id } : { error: "error" };
    },
    async audit({ actorId, testId, after }) {
      const { error } = await db.from("cc_audit_log").insert({
        actor_id: actorId,
        action: "attempt.in_person_start",
        entity_type: "cc_tests",
        entity_id: testId,
        before: null,
        after,
      });
      if (error) console.error("[cc-admin] audit write failed:", error.code ?? error.message);
    },
  };
}

/** Starts one in-person session (service client). The caller has checked adminGuard("admin"). */
export function startInPersonAttempts(
  db: AdminDb,
  input: { testId: string; studentIds: unknown; actorId: string },
  closeExpired?: InPersonStore["closeExpired"],
): Promise<InPersonStartResult> {
  return runInPersonStart(supabaseInPersonStore(db, closeExpired), input);
}

// ------------------------------------------------------------------ reads for the page

export interface InPersonTestOption extends InPersonTestRow {
  taskCount: number;
  /** Has an M4 task: the "Physical part collected" marker applies. */
  hasM4: boolean;
}

/** Tests an admin may run in person (module_package, published or admin-only), with task info. */
export async function listInPersonTests(db: AdminDb): Promise<{ ok: true; tests: InPersonTestOption[] } | { ok: false; reason: "not_set_up" | "error" }> {
  const { data, error } = await db.from("cc_tests").select(TEST_COLUMNS).eq("upload_mode", "module_package").order("slug");
  if (error) return { ok: false, reason: MISSING.has(error.code ?? "") ? "not_set_up" : "error" };
  const tests = ((data ?? []) as InPersonTestRow[]).filter(isInPersonEligible);
  if (tests.length === 0) return { ok: true, tests: [] };
  const { data: tasks } = await db
    .from("cc_test_tasks")
    .select("test_id,competition_module")
    .in(
      "test_id",
      tests.map((t) => t.id),
    );
  const rows = (tasks ?? []) as { test_id: string; competition_module: string | null }[];
  return {
    ok: true,
    tests: tests.map((t) => ({
      ...t,
      taskCount: rows.filter((r) => r.test_id === t.id).length,
      hasM4: rows.some((r) => r.test_id === t.id && r.competition_module === "M4"),
    })),
  };
}

export interface InPersonAttemptView {
  id: string;
  userId: string;
  status: string;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  partCollectedAt: string | null;
}

export interface InPersonSessionView {
  sessionId: string;
  startedAt: string;
  attempts: InPersonAttemptView[];
}

type SessionRow = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  session_id: string | null;
  phase_markers: unknown;
};

/** Groups in-person attempts by session, newest session first (pure). */
export function groupSessions(rows: readonly SessionRow[]): InPersonSessionView[] {
  const by = new Map<string, InPersonSessionView>();
  for (const r of rows) {
    const key = r.session_id ?? `single:${r.id}`;
    const markers = Array.isArray(r.phase_markers) ? (r.phase_markers as { key?: string; at?: string }[]) : [];
    const part = markers.find((m) => m && m.key === "part_collected");
    const view: InPersonAttemptView = {
      id: r.id,
      userId: r.user_id,
      status: r.status,
      startedAt: r.started_at,
      deadlineAt: r.deadline_at,
      submittedAt: r.submitted_at,
      partCollectedAt: typeof part?.at === "string" ? part.at : null,
    };
    const cur = by.get(key);
    if (!cur) by.set(key, { sessionId: key, startedAt: r.started_at, attempts: [view] });
    else {
      cur.attempts.push(view);
      if (Date.parse(r.started_at) < Date.parse(cur.startedAt)) cur.startedAt = r.started_at;
    }
  }
  return [...by.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** In-person attempts of one test from the last `days` days, grouped by session. */
export async function loadInPersonSessions(db: AdminDb, testId: string, days = 7): Promise<InPersonSessionView[]> {
  if (!isUuid(testId)) return [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("cc_attempts")
    .select("id,user_id,status,started_at,deadline_at,submitted_at,session_id,phase_markers")
    .eq("test_id", testId)
    .eq("in_person", true)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[cc-admin] in-person sessions read failed:", error.code ?? error.message);
    return [];
  }
  return groupSessions((data ?? []) as SessionRow[]);
}
