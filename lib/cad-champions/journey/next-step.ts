// Pure logic for the dashboard: the one "next step" and the 5-step journey tracker.
// Order (plan Prompt 2 Step E): complete profile, finish Get Ready, pass the practice
// upload, take the diagnostic test, view results, watch the free lesson, join the
// training, continue the training. The first unmet step wins.

import type { Locale } from "@/i18n/routing";

import { ccPath } from "../routes";

type Ts = string | null | undefined;

export type JourneyInput = {
  profile_completed_at?: Ts;
  get_ready_completed_at?: Ts;
  practice_passed_at?: Ts;
  first_test_submitted_at?: Ts;
  results_viewed_at?: Ts;
  sample_lesson_watched_at?: Ts;
  enrolled_at?: Ts;
} | null;

export type NextStepProfile = {
  full_name?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  get_ready_bypass?: boolean | null;
} | null;

/** Latest attempt at the diagnostic test (cc_attempts), newest first. */
export type NextStepAttempt = {
  status: string; // in_progress | submitted | grading | provisional | graded | expired
  submitted_at?: Ts;
} | null;

export const NEXT_STEP_IDS = [
  "complete_profile",
  "finish_get_ready",
  "pass_practice",
  "take_test",
  "view_results",
  "watch_free_lesson",
  "join_training",
  "continue_training",
] as const;
export type NextStepId = (typeof NEXT_STEP_IDS)[number];

export type NextStep = {
  id: NextStepId;
  /** Key under CC.dashboard nextStep.reason.<reasonKey> */
  reasonKey: string;
  /** Key under CC.dashboard nextStep.cta.<ctaKey> */
  ctaKey: string;
  href: string;
};

const SUBMITTED_STATUSES = ["submitted", "grading", "provisional", "graded"];
const RESULT_READY_STATUSES = ["provisional", "graded"];

function has(v: Ts): boolean {
  return typeof v === "string" && v.length > 0;
}

function profileDone(journey: JourneyInput, profile: NextStepProfile): boolean {
  if (has(journey?.profile_completed_at)) return true;
  return Boolean(profile?.full_name?.trim() && profile?.phone?.trim() && profile?.date_of_birth);
}

type Facts = {
  profile: boolean;
  getReady: boolean;
  practice: boolean;
  submitted: boolean;
  resultsViewed: boolean;
  lesson: boolean;
  enrolled: boolean;
};

function facts(journey: JourneyInput, profile: NextStepProfile, attempt?: NextStepAttempt): Facts {
  const bypass = Boolean(profile?.get_ready_bypass);
  return {
    profile: profileDone(journey, profile),
    getReady: has(journey?.get_ready_completed_at) || bypass,
    practice: has(journey?.practice_passed_at) || bypass,
    submitted: has(journey?.first_test_submitted_at) || (attempt ? SUBMITTED_STATUSES.includes(attempt.status) : false),
    resultsViewed: has(journey?.results_viewed_at),
    lesson: has(journey?.sample_lesson_watched_at),
    enrolled: has(journey?.enrolled_at),
  };
}

export function nextStep(
  journey: JourneyInput,
  profile: NextStepProfile,
  attempt?: NextStepAttempt,
  locale: Locale = "en",
): NextStep {
  const f = facts(journey, profile, attempt);
  const go = (id: NextStepId, path: string, key: string = id): NextStep => ({
    id,
    reasonKey: key,
    ctaKey: key,
    href: ccPath(locale, path),
  });

  if (!f.profile) return go("complete_profile", "/account");
  if (!f.getReady) return go("finish_get_ready", "/get-ready");
  if (!f.practice) return go("pass_practice", "/get-ready");
  if (!f.submitted) {
    if (attempt?.status === "in_progress") return go("take_test", "/test", "take_test_resume");
    if (attempt?.status === "expired") return go("take_test", "/test", "take_test_expired");
    return go("take_test", "/test");
  }
  if (!f.resultsViewed) {
    const ready = attempt ? RESULT_READY_STATUSES.includes(attempt.status) : true;
    return go("view_results", "/results", ready ? "view_results" : "view_results_grading");
  }
  if (!f.lesson) return go("watch_free_lesson", "/training");
  if (!f.enrolled) return go("join_training", "/training");
  return go("continue_training", "/training");
}

// ---------------------------------------------------------------- tracker

export const TRACKER_IDS = ["get_ready", "free_test", "results", "free_lesson", "training"] as const;
export type TrackerId = (typeof TRACKER_IDS)[number];
export type TrackerStatus = "done" | "current" | "upcoming" | "locked";

export type TrackerStep = {
  id: TrackerId;
  status: TrackerStatus;
  /** Key under CC.dashboard tracker.locked.<lockedReasonKey>; only when status is locked. */
  lockedReasonKey?: string;
};

export function journeySteps(
  journey: JourneyInput,
  profile: NextStepProfile,
  attempt?: NextStepAttempt,
): TrackerStep[] {
  const f = facts(journey, profile, attempt);
  const current = nextStep(journey, profile, attempt).id;
  const ready = f.getReady && f.practice;

  const make = (id: TrackerId, done: boolean, currentIds: NextStepId[], lock: string | null): TrackerStep => {
    if (done) return { id, status: "done" };
    if (currentIds.includes(current)) return { id, status: "current" };
    if (lock) return { id, status: "locked", lockedReasonKey: lock };
    return { id, status: "upcoming" };
  };

  return [
    make("get_ready", ready, ["finish_get_ready", "pass_practice"], f.profile ? null : "profile"),
    make("free_test", f.submitted, ["take_test"], ready ? null : "get_ready"),
    make("results", f.resultsViewed, ["view_results"], f.submitted ? null : "test"),
    make("free_lesson", f.lesson, ["watch_free_lesson"], f.resultsViewed ? null : "results"),
    make("training", false, ["join_training", "continue_training"], f.resultsViewed ? null : "results"),
  ];
}
