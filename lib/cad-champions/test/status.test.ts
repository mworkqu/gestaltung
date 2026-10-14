import { describe, expect, it } from "vitest";

import {
  acceptsWork,
  allSettled,
  introState,
  isFinishedStatus,
  liveTaskState,
  submitReasonFor,
  taskChip,
  tasksWithoutFiles,
  type AttemptLite,
} from "./status";

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const READY = { ready: true, reasonKey: "ready" as const, remaining: 0 };
const NOT_READY = { ready: false, reasonKey: "not_finished" as const, remaining: 3 };

function attempt(p: Partial<AttemptLite> & { started: number }): AttemptLite {
  return {
    id: p.id ?? "a1",
    status: p.status ?? "in_progress",
    started_at: iso(p.started),
    deadline_at: p.deadline_at === undefined ? iso(p.started + 90 * 60_000) : p.deadline_at,
    submitted_at: p.submitted_at ?? null,
  };
}

describe("introState", () => {
  it("offers to continue a running attempt with the time left", () => {
    const a = attempt({ started: NOW - 43 * 60_000 });
    const s = introState({ attempts: [a], testType: "diagnostic", cooldownDays: 14, gate: READY, now: NOW });
    expect(s).toEqual({ kind: "continue", attemptId: "a1", secondsLeft: 47 * 60 });
  });

  it("continues an untimed attempt with no time left value", () => {
    const a = attempt({ started: NOW - 1000, deadline_at: null });
    const s = introState({ attempts: [a], testType: "practice", cooldownDays: 0, gate: NOT_READY, now: NOW });
    expect(s).toEqual({ kind: "continue", attemptId: "a1", secondsLeft: null });
  });

  it("still continues within the grace period (0 seconds left)", () => {
    const a = attempt({ started: NOW - 90 * 60_000 - 30_000 });
    const s = introState({ attempts: [a], testType: "diagnostic", cooldownDays: 14, gate: READY, now: NOW });
    expect(s).toEqual({ kind: "continue", attemptId: "a1", secondsLeft: 0 });
  });

  it("treats an attempt past deadline + grace as finished (cooldown applies)", () => {
    const started = NOW - 3 * 3_600_000;
    const a = attempt({ started });
    const s = introState({ attempts: [a], testType: "diagnostic", cooldownDays: 14, gate: READY, now: NOW });
    expect(s.kind).toBe("cooldown");
    if (s.kind === "cooldown") expect(s.retakeAt).toBe(started + 90 * 60_000 + 14 * 86_400_000);
  });

  it("shows the cooldown from the submit time", () => {
    const submitted = NOW - 2 * 86_400_000;
    const a = attempt({ started: submitted - 3_600_000, status: "graded", submitted_at: iso(submitted) });
    const s = introState({ attempts: [a], testType: "diagnostic", cooldownDays: 14, gate: READY, now: NOW });
    expect(s).toMatchObject({ kind: "cooldown", retakeAt: submitted + 14 * 86_400_000 });
  });

  it("allows a retake after the cooldown", () => {
    const submitted = NOW - 15 * 86_400_000;
    const a = attempt({ started: submitted - 3_600_000, status: "graded", submitted_at: iso(submitted) });
    const s = introState({ attempts: [a], testType: "diagnostic", cooldownDays: 14, gate: READY, now: NOW });
    expect(s).toEqual({ kind: "start", last: a });
  });

  it("uses the newest attempt", () => {
    const old = attempt({ id: "old", started: NOW - 40 * 86_400_000, status: "graded", submitted_at: iso(NOW - 40 * 86_400_000) });
    const recent = attempt({ id: "new", started: NOW - 86_400_000, status: "grading", submitted_at: iso(NOW - 86_400_000) });
    const s = introState({ attempts: [old, recent], testType: "diagnostic", cooldownDays: 14, gate: READY, now: NOW });
    expect(s).toMatchObject({ kind: "cooldown", last: { id: "new" } });
  });

  it("locks the test until Get Ready is done", () => {
    const s = introState({ attempts: [], testType: "diagnostic", cooldownDays: 14, gate: NOT_READY, now: NOW });
    expect(s).toEqual({ kind: "locked", reason: "not_finished", remaining: 3 });
  });

  it("never locks practice tests or staff", () => {
    expect(introState({ attempts: [], testType: "practice", cooldownDays: 0, gate: NOT_READY, now: NOW }).kind).toBe("start");
    expect(introState({ attempts: [], testType: "diagnostic", cooldownDays: 14, gate: NOT_READY, isStaff: true, now: NOW }).kind).toBe("start");
  });
});

describe("server rules", () => {
  const deadline = iso(NOW);
  it("accepts work until deadline + grace", () => {
    expect(acceptsWork({ status: "in_progress", deadline_at: deadline }, NOW + 60_000)).toBe(true);
    expect(acceptsWork({ status: "in_progress", deadline_at: deadline }, NOW + 60_001)).toBe(false);
    expect(acceptsWork({ status: "submitted", deadline_at: deadline }, NOW - 1)).toBe(false);
    expect(acceptsWork({ status: "in_progress", deadline_at: null }, NOW + 10 ** 9)).toBe(true);
  });

  it("records timeout once the deadline passed", () => {
    expect(submitReasonFor(NOW - 1, deadline)).toBe("manual");
    expect(submitReasonFor(NOW, deadline)).toBe("timeout");
    expect(submitReasonFor(NOW + 30_000, deadline)).toBe("timeout");
    expect(submitReasonFor(NOW, null)).toBe("manual");
  });
});

describe("liveTaskState", () => {
  it("maps result statuses", () => {
    expect(liveTaskState({ hasFile: false, resultStatus: "pending", gradingMode: "auto_step" })).toBe("no_file");
    expect(liveTaskState({ hasFile: true, resultStatus: "pending", gradingMode: "auto_step" })).toBe("checking");
    expect(liveTaskState({ hasFile: true, resultStatus: null, gradingMode: "ai_drawing" })).toBe("checking");
    expect(liveTaskState({ hasFile: true, resultStatus: "pending", gradingMode: "manual" })).toBe("waiting_trainer");
    expect(liveTaskState({ hasFile: true, resultStatus: "auto", gradingMode: "auto_step" })).toBe("done");
    expect(liveTaskState({ hasFile: true, resultStatus: "final", gradingMode: "ai_drawing" })).toBe("done");
    expect(liveTaskState({ hasFile: true, resultStatus: "ai_pending_review", gradingMode: "ai_drawing" })).toBe("waiting_trainer");
    expect(liveTaskState({ hasFile: true, resultStatus: "error", gradingMode: "auto_step" })).toBe("error");
  });

  it("is settled when nothing is being checked", () => {
    expect(allSettled(["done", "no_file", "waiting_trainer", "error"])).toBe(true);
    expect(allSettled(["done", "checking"])).toBe(false);
  });
});

describe("helpers", () => {
  it("lists tasks without files in order", () => {
    const tasks = [
      { id: "t4", position: 4 },
      { id: "t1", position: 1 },
      { id: "t3", position: 3 },
      { id: "t2", position: 2 },
    ];
    expect(tasksWithoutFiles(tasks, ["t1", "t2"]).map((t) => t.id)).toEqual(["t3", "t4"]);
    expect(tasksWithoutFiles(tasks, ["t1", "t2", "t3", "t4"])).toEqual([]);
  });

  it("picks the task chip", () => {
    expect(taskChip({ uploaded: false, busy: false, failed: false })).toBe("not_started");
    expect(taskChip({ uploaded: true, busy: true, failed: false })).toBe("uploading");
    expect(taskChip({ uploaded: true, busy: false, failed: true })).toBe("failed");
    expect(taskChip({ uploaded: true, busy: false, failed: false })).toBe("uploaded");
  });

  it("knows finished statuses", () => {
    expect(isFinishedStatus("in_progress")).toBe(false);
    expect(isFinishedStatus("grading")).toBe(true);
  });
});
