import { describe, expect, it } from "vitest";

import { activeEnrollmentEnd, buildJourneyTimeline, cleanNote, isUuid, NOTE_MAX, parseExtendDays, planEnrollmentExtension, summariseExercises } from "./student-detail";
import { parseBool, verificationState } from "./student-actions";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-14T09:00:00Z");

describe("buildJourneyTimeline", () => {
  it("orders sign-up, Get Ready steps and journey stamps by date", () => {
    const events = buildJourneyTimeline({
      createdAt: "2026-10-01T08:00:00Z",
      journey: {
        profile_completed_at: "2026-10-01T08:05:00Z",
        get_ready_completed_at: "2026-10-03T10:00:00Z",
        practice_passed_at: null,
        first_test_submitted_at: "2026-10-05T12:00:00Z",
      },
      steps: [
        { step_key: "check_computer", completed_at: "2026-10-02T09:00:00Z" },
        { step_key: "welcome_video", completed_at: "2026-10-02T08:00:00Z" },
      ],
    });
    expect(events.map((e) => (e.kind === "journey" ? e.key : e.kind === "get_ready_step" ? e.step : e.kind))).toEqual([
      "signed_up",
      "profile_completed_at",
      "welcome_video",
      "check_computer",
      "get_ready_completed_at",
      "first_test_submitted_at",
    ]);
  });

  it("drops missing and invalid dates", () => {
    const events = buildJourneyTimeline({ createdAt: null, journey: { enrolled_at: "not a date" }, steps: [{ step_key: "x", completed_at: "" }] });
    expect(events).toEqual([]);
  });

  it("keeps the natural order on equal times", () => {
    const at = "2026-10-01T08:00:00Z";
    const events = buildJourneyTimeline({ createdAt: at, journey: { profile_completed_at: at }, steps: [{ step_key: "welcome_video", completed_at: at }] });
    expect(events.map((e) => e.kind)).toEqual(["signed_up", "get_ready_step", "journey"]);
  });
});

describe("summariseExercises", () => {
  it("counts tries, keeps the best percent, passed ever and the latest try", () => {
    const out = summariseExercises([
      { exercise_id: "a", status: "final", percent: 40, passed: false, created_at: "2026-10-01T00:00:00Z" },
      { exercise_id: "a", status: "final", percent: 85, passed: true, created_at: "2026-10-02T00:00:00Z" },
      { exercise_id: "a", status: "error", percent: null, passed: null, created_at: "2026-10-03T00:00:00Z" },
      { exercise_id: "b", status: "auto", percent: 60, passed: false, created_at: "2026-09-01T00:00:00Z" },
    ]);
    expect(out).toEqual([
      { exerciseId: "a", attempts: 3, bestPercent: 85, passed: true, lastAt: "2026-10-03T00:00:00Z", lastStatus: "error" },
      { exerciseId: "b", attempts: 1, bestPercent: 60, passed: false, lastAt: "2026-09-01T00:00:00Z", lastStatus: "auto" },
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(summariseExercises([])).toEqual([]);
  });
});

describe("parseExtendDays", () => {
  it("accepts whole days 1..365", () => {
    expect(parseExtendDays("30")).toBe(30);
    expect(parseExtendDays(" 1 ")).toBe(1);
    expect(parseExtendDays(365)).toBe(365);
  });
  it("rejects anything else", () => {
    for (const v of ["0", "366", "-5", "2.5", "1e2", "", "abc", null, undefined, 3.5, "١٠"]) expect(parseExtendDays(v)).toBeNull();
  });
});

describe("planEnrollmentExtension", () => {
  const e = (id: string, endsInDays: number, status = "active") => ({
    id,
    status,
    starts_at: new Date(NOW - 10 * DAY).toISOString(),
    ends_at: new Date(NOW + endsInDays * DAY).toISOString(),
  });

  it("extends the active enrollment that ends last", () => {
    const plan = planEnrollmentExtension([e("a", 5), e("b", 20), e("c", 40, "cancelled")], 30, NOW);
    expect(plan).toEqual({ kind: "extend", enrollmentId: "b", fromEndsAt: e("b", 20).ends_at, endsAt: new Date(NOW + 50 * DAY).toISOString() });
  });

  it("creates an admin enrollment from now when none is active", () => {
    const plan = planEnrollmentExtension([e("a", -1), e("b", 30, "expired")], 14, NOW);
    expect(plan).toEqual({ kind: "create", startsAt: new Date(NOW).toISOString(), endsAt: new Date(NOW + 14 * DAY).toISOString() });
  });

  it("activeEnrollmentEnd shows the latest future end", () => {
    expect(activeEnrollmentEnd([e("a", 3), e("b", 9)], NOW)).toBe(e("b", 9).ends_at);
    expect(activeEnrollmentEnd([e("a", -3)], NOW)).toBeNull();
  });
});

describe("cleanNote / isUuid", () => {
  it("trims notes and enforces the length", () => {
    expect(cleanNote("  hello \r\n world ")).toBe("hello \n world");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(42)).toBeNull();
    expect(cleanNote("x".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(cleanNote("x".repeat(NOTE_MAX + 1))).toBeNull();
  });
  it("checks uuids", () => {
    expect(isUuid("6b5907f2-c957-43f9-bce8-42e73beeff33")).toBe(true);
    expect(isUuid("6b5907f2-c957-43f9-bce8")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("student actions helpers", () => {
  it("verificationState", () => {
    expect(verificationState(null)).toBe("no_email");
    expect(verificationState({ email: null })).toBe("no_email");
    expect(verificationState({ email: "a@b.qa", email_confirmed_at: null })).toBe("unconfirmed");
    expect(verificationState({ email: "a@b.qa", email_confirmed_at: "2026-10-01T00:00:00Z" })).toBe("confirmed");
    expect(verificationState({ email: "a@b.qa", confirmed_at: "2026-10-01T00:00:00Z" })).toBe("confirmed");
  });
  it("parseBool", () => {
    expect(parseBool(true)).toBe(true);
    expect(parseBool("1")).toBe(true);
    expect(parseBool("false")).toBe(false);
    expect(parseBool("yes")).toBeNull();
  });
});
