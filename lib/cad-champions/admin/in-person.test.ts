import { describe, expect, it } from "vitest";

import { REQUIRED_STEP_KEYS } from "../get-ready/steps";
import { cleanStudentIds, groupSessions, IN_PERSON_MAX_STUDENTS, isInPersonEligible, runInPersonStart, type InPersonStore, type InPersonTestRow } from "./in-person";

const NOW = Date.parse("2026-10-14T09:00:00Z");
const TEST_ID = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const test: InPersonTestRow = {
  id: TEST_ID,
  slug: "mock-m4",
  title_en: "Mock M4",
  title_ar: "تجريبي M4",
  type: "mock",
  upload_mode: "module_package",
  is_published: false,
  admin_only: true,
  time_limit_minutes: 240,
  retake_cooldown_days: 7,
  grace_seconds: 60,
};

type Inserted = Record<string, unknown>;

function fakeStore(over: Partial<InPersonStore> = {}, extra: { attempts?: Awaited<ReturnType<InPersonStore["loadAttempts"]>>; conflict?: string[] } = {}) {
  const inserted: Inserted[] = [];
  const audits: unknown[] = [];
  const closed: string[] = [];
  const store: InPersonStore = {
    loadTest: async (id) => ({ ok: true, test: id === TEST_ID ? test : null }),
    taskCount: async () => 3,
    loadStudents: async () => ({
      profiles: [
        { id: A, role: "student", get_ready_bypass: false },
        { id: B, role: "student", get_ready_bypass: true },
        { id: C, role: "student", get_ready_bypass: false },
        { id: D, role: "student", get_ready_bypass: false },
        { id: E, role: "instructor", get_ready_bypass: false },
      ],
      journey: [{ user_id: A, get_ready_completed_at: "2026-10-01T00:00:00Z" }],
      steps: REQUIRED_STEP_KEYS.map((k) => ({ user_id: D, step_key: k as string })),
    }),
    loadAttempts: async () => extra.attempts ?? [],
    closeExpired: async (a) => {
      closed.push(a.id);
    },
    insertAttempt: async (row) => {
      if (extra.conflict?.includes(String(row.user_id))) return { error: "23505" };
      inserted.push(row);
      return { id: `att-${String(row.user_id).slice(0, 1)}` };
    },
    audit: async (entry) => {
      audits.push(entry);
    },
    ...over,
  };
  return { store, inserted, audits, closed };
}

describe("isInPersonEligible / cleanStudentIds", () => {
  it("needs module_package and published or admin-only", () => {
    expect(isInPersonEligible({ upload_mode: "module_package", is_published: true, admin_only: false })).toBe(true);
    expect(isInPersonEligible({ upload_mode: "module_package", is_published: false, admin_only: true })).toBe(true);
    expect(isInPersonEligible({ upload_mode: "module_package", is_published: false, admin_only: false })).toBe(false);
    expect(isInPersonEligible({ upload_mode: "per_task", is_published: true, admin_only: false })).toBe(false);
  });
  it("keeps distinct valid uuids", () => {
    expect(cleanStudentIds([A, A.toUpperCase(), "nope", 3, B])).toEqual([A, B]);
    expect(cleanStudentIds("x")).toEqual([]);
  });
});

describe("runInPersonStart", () => {
  it("starts eligible students with one shared session and the normal deadline", async () => {
    const { store, inserted, audits } = fakeStore();
    const res = await runInPersonStart(store, { testId: TEST_ID, studentIds: [A, B, C, D, E], actorId: "admin", now: NOW, sessionId: "sess-1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.started.map((s) => s.studentId)).toEqual([A, B, D]);
    expect(res.skipped).toEqual([
      { studentId: C, reason: "get_ready" },
      { studentId: E, reason: "not_found" },
    ]);
    expect(res.deadlineAt).toBe(new Date(NOW + 240 * 60_000).toISOString());
    for (const row of inserted) {
      expect(row).toMatchObject({
        test_id: TEST_ID,
        in_person: true,
        session_id: "sess-1",
        status: "in_progress",
        started_at: new Date(NOW).toISOString(),
        deadline_at: new Date(NOW + 240 * 60_000).toISOString(),
        start_ip: null,
      });
    }
    expect(audits).toHaveLength(1);
  });

  it("skips (and reports) students with an attempt in progress or in the cooldown", async () => {
    const { store, inserted } = fakeStore(
      {},
      {
        attempts: [
          { id: "run", user_id: A, status: "in_progress", started_at: new Date(NOW - 60_000).toISOString(), deadline_at: new Date(NOW + 3_600_000).toISOString(), submitted_at: null },
          { id: "old", user_id: B, status: "graded", started_at: new Date(NOW - 2 * 86_400_000).toISOString(), deadline_at: null, submitted_at: new Date(NOW - 2 * 86_400_000).toISOString() },
        ],
      },
    );
    const res = await runInPersonStart(store, { testId: TEST_ID, studentIds: [A, B, D], actorId: "admin", now: NOW });
    expect(res.ok && res.skipped).toEqual([
      { studentId: A, reason: "in_progress" },
      { studentId: B, reason: "cooldown" },
    ]);
    expect(inserted.map((r) => r.user_id)).toEqual([D]);
  });

  it("closes an expired in-progress attempt first, then applies the cooldown", async () => {
    const { store, closed } = fakeStore(
      {},
      {
        attempts: [
          { id: "stale", user_id: D, status: "in_progress", started_at: new Date(NOW - 10 * 86_400_000).toISOString(), deadline_at: new Date(NOW - 9 * 86_400_000).toISOString(), submitted_at: null },
        ],
      },
    );
    const res = await runInPersonStart(store, { testId: TEST_ID, studentIds: [D], actorId: "admin", now: NOW });
    expect(closed).toEqual(["stale"]);
    expect(res.ok && res.started.map((s) => s.studentId)).toEqual([D]);
  });

  it("reports a race on the one-active-attempt index as in progress", async () => {
    const { store } = fakeStore({}, { conflict: [A] });
    const res = await runInPersonStart(store, { testId: TEST_ID, studentIds: [A], actorId: "admin", now: NOW });
    expect(res.ok && res.skipped).toEqual([{ studentId: A, reason: "in_progress" }]);
  });

  it("validates the input and the test", async () => {
    const { store } = fakeStore();
    expect(await runInPersonStart(store, { testId: "x", studentIds: [A], actorId: "a" })).toEqual({ ok: false, error: "invalid" });
    expect(await runInPersonStart(store, { testId: TEST_ID, studentIds: [], actorId: "a" })).toEqual({ ok: false, error: "invalid", detail: "no_students" });
    const many = Array.from({ length: IN_PERSON_MAX_STUDENTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await runInPersonStart(store, { testId: TEST_ID, studentIds: many, actorId: "a" })).toEqual({ ok: false, error: "invalid", detail: "too_many" });
    expect(await runInPersonStart(store, { testId: "22222222-2222-4222-8222-222222222222", studentIds: [A], actorId: "a" })).toEqual({ ok: false, error: "not_found" });

    const perTask = fakeStore({ loadTest: async () => ({ ok: true, test: { ...test, upload_mode: "per_task" } }) });
    expect(await runInPersonStart(perTask.store, { testId: TEST_ID, studentIds: [A], actorId: "a" })).toEqual({ ok: false, error: "invalid", detail: "not_package" });
    const empty = fakeStore({ taskCount: async () => 0 });
    expect(await runInPersonStart(empty.store, { testId: TEST_ID, studentIds: [A], actorId: "a" })).toEqual({ ok: false, error: "invalid", detail: "no_tasks" });
    const missing = fakeStore({ loadTest: async () => ({ ok: false, code: "42703" }) });
    expect(await runInPersonStart(missing.store, { testId: TEST_ID, studentIds: [A], actorId: "a" })).toEqual({ ok: false, error: "not_set_up" });
  });

  it("an untimed test gets no deadline", async () => {
    const { store, inserted } = fakeStore({ loadTest: async () => ({ ok: true, test: { ...test, time_limit_minutes: null } }) });
    const res = await runInPersonStart(store, { testId: TEST_ID, studentIds: [A], actorId: "a", now: NOW });
    expect(res.ok && res.deadlineAt).toBeNull();
    expect(inserted[0].deadline_at).toBeNull();
  });
});

describe("groupSessions", () => {
  it("groups by session, newest first, and reads the part_collected marker", () => {
    const out = groupSessions([
      { id: "1", user_id: A, status: "in_progress", started_at: "2026-10-14T08:00:00Z", deadline_at: null, submitted_at: null, session_id: "s1", phase_markers: [{ key: "part_collected", at: "2026-10-14T10:00:00Z" }] },
      { id: "2", user_id: B, status: "in_progress", started_at: "2026-10-14T08:00:00Z", deadline_at: null, submitted_at: null, session_id: "s1", phase_markers: [] },
      { id: "3", user_id: C, status: "graded", started_at: "2026-10-15T08:00:00Z", deadline_at: null, submitted_at: null, session_id: null, phase_markers: null },
    ]);
    expect(out.map((s) => s.sessionId)).toEqual(["single:3", "s1"]);
    expect(out[1].attempts.map((a) => a.partCollectedAt)).toEqual(["2026-10-14T10:00:00Z", null]);
  });
});
