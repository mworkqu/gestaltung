import { describe, expect, it } from "vitest";

import { journeySteps, nextStep } from "./next-step";

const T = "2026-01-01T00:00:00Z";
const profile = { full_name: "Sara", phone: "+97455551234", date_of_birth: "2008-01-01" };

describe("nextStep", () => {
  it("asks to complete the profile first", () => {
    expect(nextStep(null, null).id).toBe("complete_profile");
    expect(nextStep({}, { full_name: "x" }).id).toBe("complete_profile");
  });
  it("treats required fields or the journey stamp as a complete profile", () => {
    expect(nextStep({}, profile).id).toBe("finish_get_ready");
    expect(nextStep({ profile_completed_at: T }, null).id).toBe("finish_get_ready");
  });
  it("follows the plan order", () => {
    const j: Record<string, string> = { profile_completed_at: T };
    expect(nextStep(j, profile).id).toBe("finish_get_ready");
    j.get_ready_completed_at = T;
    expect(nextStep(j, profile).id).toBe("pass_practice");
    j.practice_passed_at = T;
    expect(nextStep(j, profile).id).toBe("take_test");
    j.first_test_submitted_at = T;
    expect(nextStep(j, profile).id).toBe("view_results");
    j.results_viewed_at = T;
    expect(nextStep(j, profile).id).toBe("watch_free_lesson");
    j.sample_lesson_watched_at = T;
    expect(nextStep(j, profile).id).toBe("join_training");
    j.enrolled_at = T;
    expect(nextStep(j, profile).id).toBe("continue_training");
  });
  it("lets get_ready_bypass skip Get Ready and the practice", () => {
    expect(nextStep({}, { ...profile, get_ready_bypass: true }).id).toBe("take_test");
  });
  it("resumes an attempt in progress and explains an expired one", () => {
    const j = { profile_completed_at: T, get_ready_completed_at: T, practice_passed_at: T };
    expect(nextStep(j, profile, { status: "in_progress" }).reasonKey).toBe("take_test_resume");
    expect(nextStep(j, profile, { status: "expired" }).reasonKey).toBe("take_test_expired");
  });
  it("shows a grading reason until results are ready", () => {
    const j = { profile_completed_at: T, get_ready_completed_at: T, practice_passed_at: T };
    expect(nextStep(j, profile, { status: "grading" })).toMatchObject({ id: "view_results", reasonKey: "view_results_grading" });
    expect(nextStep(j, profile, { status: "graded" })).toMatchObject({ id: "view_results", reasonKey: "view_results" });
  });
  it("builds locale-aware hrefs", () => {
    expect(nextStep(null, null, null, "ar").href).toBe("/cad-champions/ar/account");
    expect(nextStep({ profile_completed_at: T }, null).href).toBe("/cad-champions/en/get-ready");
  });
});

describe("journeySteps", () => {
  it("locks later steps and names what unlocks them", () => {
    const s = journeySteps({ profile_completed_at: T }, profile);
    expect(s.map((x) => x.status)).toEqual(["current", "locked", "locked", "locked", "locked"]);
    expect(s[1].lockedReasonKey).toBe("get_ready");
    expect(s[2].lockedReasonKey).toBe("test");
    expect(s[3].lockedReasonKey).toBe("results");
  });
  it("marks done and current as the journey advances", () => {
    const j = {
      profile_completed_at: T,
      get_ready_completed_at: T,
      practice_passed_at: T,
      first_test_submitted_at: T,
    };
    const s = journeySteps(j, profile, { status: "graded" });
    expect(s.map((x) => x.status)).toEqual(["done", "done", "current", "locked", "locked"]);
  });
  it("keeps Get Ready locked until the profile is complete", () => {
    const s = journeySteps(null, null);
    expect(s[0]).toMatchObject({ status: "locked", lockedReasonKey: "profile" });
  });
  it("marks training current once enrolled", () => {
    const j = {
      profile_completed_at: T,
      get_ready_completed_at: T,
      practice_passed_at: T,
      first_test_submitted_at: T,
      results_viewed_at: T,
      sample_lesson_watched_at: T,
      enrolled_at: T,
    };
    const s = journeySteps(j, profile);
    expect(s.map((x) => x.status)).toEqual(["done", "done", "done", "done", "current"]);
  });
});
