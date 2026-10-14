// Get Ready (Prompt 4 Step A/B/C): the 7 step definitions as data, plus pure
// status helpers. No I/O here, so it is safe in client and server code and is
// unit-tested in steps.test.ts.
//
// Storage: one cc_get_ready_steps row per finished step (step_key = the step
// key). Checklist sub-items are stored as their own rows with the key
// `${stepKey}__${subKey}` (see subItemKey), so ticks survive a reload. Only
// plain step keys count towards progress.

import type { CcJourneyProgress, CcProfile } from "../db/types";

/**
 * How a step becomes done:
 * - video: the welcome video reaches 90% watched (real player) or "Mark as watched" (placeholder)
 * - manual: the student presses "Mark as done"
 * - checklist: done when every sub-item is ticked
 * - practice: done when the practice upload passes the grader
 * - demo: done when the test-screen demo ends (or "Mark as done")
 */
export type GetReadyAutoComplete = "video" | "manual" | "checklist" | "practice" | "demo";

export const GET_READY_STEP_KEYS = [
  "welcome_video",
  "check_computer",
  "install_software",
  "essential_actions",
  "practice_upload",
  "try_test_screen",
  "test_day_checklist",
] as const;

export type GetReadyStepKey = (typeof GET_READY_STEP_KEYS)[number];

export interface GetReadyStepDef {
  key: GetReadyStepKey;
  required: boolean;
  autoComplete: GetReadyAutoComplete;
  /** Estimated minutes, not counting software download/install time. */
  minutes: number;
  /** Checklist sub-items (checklist steps only), in display order. */
  subItems: readonly string[];
}

export const ESSENTIAL_ACTION_KEYS = ["units_mm", "material_density", "export_step", "export_pdf", "find_upload"] as const;
export type EssentialActionKey = (typeof ESSENTIAL_ACTION_KEYS)[number];

export const TEST_DAY_CHECK_KEYS = [
  "time_90",
  "charged",
  "close_apps",
  "cad_ready",
  "know_exports",
  "upload_each",
  "work_alone",
] as const;
export type TestDayCheckKey = (typeof TEST_DAY_CHECK_KEYS)[number];

export const GET_READY_STEPS: readonly GetReadyStepDef[] = [
  { key: "welcome_video", required: true, autoComplete: "video", minutes: 5, subItems: [] },
  { key: "check_computer", required: true, autoComplete: "manual", minutes: 5, subItems: [] },
  { key: "install_software", required: true, autoComplete: "manual", minutes: 10, subItems: [] },
  { key: "essential_actions", required: true, autoComplete: "checklist", minutes: 15, subItems: ESSENTIAL_ACTION_KEYS },
  { key: "practice_upload", required: true, autoComplete: "practice", minutes: 5, subItems: [] },
  { key: "try_test_screen", required: false, autoComplete: "demo", minutes: 5, subItems: [] },
  { key: "test_day_checklist", required: true, autoComplete: "checklist", minutes: 2, subItems: TEST_DAY_CHECK_KEYS },
];

export const REQUIRED_STEP_KEYS: readonly GetReadyStepKey[] = GET_READY_STEPS.filter((s) => s.required).map((s) => s.key);

/** Total estimated minutes for all steps (about 45). */
export const GET_READY_TOTAL_MINUTES = GET_READY_STEPS.reduce((sum, s) => sum + s.minutes, 0);

/** Steps a student may finish with "Mark as done" from the browser (practice is grader-only, checklists via ticks). */
export const MANUALLY_MARKABLE: readonly GetReadyStepKey[] = ["welcome_video", "check_computer", "install_software", "try_test_screen"];

export function isGetReadyStepKey(value: unknown): value is GetReadyStepKey {
  return typeof value === "string" && (GET_READY_STEP_KEYS as readonly string[]).includes(value);
}

export function getStepDef(key: GetReadyStepKey): GetReadyStepDef {
  return GET_READY_STEPS.find((s) => s.key === key)!;
}

const SUB_SEP = "__";

/** Row key for a checklist tick, e.g. "essential_actions__units_mm". */
export function subItemKey(stepKey: GetReadyStepKey, subKey: string): string {
  return `${stepKey}${SUB_SEP}${subKey}`;
}

/** True when `subKey` is a sub-item of the checklist step `stepKey`. */
export function isSubItemOf(stepKey: GetReadyStepKey, subKey: unknown): subKey is string {
  return typeof subKey === "string" && getStepDef(stepKey).subItems.includes(subKey);
}

/** Ticked sub-items of one step, from the stored keys. */
export function tickedSubItems(stepKey: GetReadyStepKey, stored: Iterable<string>): Set<string> {
  const prefix = `${stepKey}${SUB_SEP}`;
  const out = new Set<string>();
  for (const k of stored) {
    if (k.startsWith(prefix)) {
      const sub = k.slice(prefix.length);
      if (isSubItemOf(stepKey, sub)) out.add(sub);
    }
  }
  return out;
}

/** True when every sub-item of a checklist step is ticked. */
export function allSubItemsTicked(stepKey: GetReadyStepKey, stored: Iterable<string>): boolean {
  const def = getStepDef(stepKey);
  if (def.subItems.length === 0) return false;
  const ticked = tickedSubItems(stepKey, stored);
  return def.subItems.every((s) => ticked.has(s));
}

export interface GetReadyStatus {
  /** 0-100, share of REQUIRED steps done (the optional demo does not change it). */
  percent: number;
  /** Required steps not done yet, in order. */
  remainingRequired: GetReadyStepKey[];
  /** All required steps done. */
  complete: boolean;
  /** The first step (in order, optional included) that is not done; null when all 7 are done. */
  nextStep: GetReadyStepKey | null;
  /** Steps done (plain step keys only). */
  done: Set<GetReadyStepKey>;
}

/**
 * Overall Get Ready status from the stored step keys. `profile` is accepted
 * for future per-profile rules (e.g. a step that only applies to some
 * students); today every student has the same 7 steps.
 */
export function computeGetReady(
  stepsDone: Iterable<string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  profile?: Pick<CcProfile, "has_windows_pc" | "track_software"> | null
): GetReadyStatus {
  const done = new Set<GetReadyStepKey>();
  for (const k of stepsDone) if (isGetReadyStepKey(k)) done.add(k);
  const remainingRequired = REQUIRED_STEP_KEYS.filter((k) => !done.has(k));
  const requiredDone = REQUIRED_STEP_KEYS.length - remainingRequired.length;
  const percent = Math.round((requiredDone / REQUIRED_STEP_KEYS.length) * 100);
  const nextStep = GET_READY_STEP_KEYS.find((k) => !done.has(k)) ?? null;
  return { percent, remainingRequired, complete: remainingRequired.length === 0, nextStep, done };
}

export type GetReadyGateReason = "ready" | "bypassed" | "not_finished" | "no_profile";

export interface GetReadyGate {
  ready: boolean;
  /** Message key suffix for the reason (e.g. CC.get-ready.gate.<reasonKey>). */
  reasonKey: GetReadyGateReason;
  /** Required steps left (0 when ready). */
  remaining: number;
}

/**
 * Whether the diagnostic test may start (Prompt 4 Step C; Prompt 5 uses it
 * for the Start button). Ready when an admin set get_ready_bypass, when the
 * journey has get_ready_completed_at, or when `stepsDone` shows every
 * required step done. Pass `stepsDone` to get an exact "N steps left" count;
 * without it, an unfinished student counts as all required steps left.
 */
export function getReadyGate(
  profile: Pick<CcProfile, "get_ready_bypass"> | null | undefined,
  journey: Pick<CcJourneyProgress, "get_ready_completed_at"> | null | undefined,
  stepsDone?: Iterable<string>
): GetReadyGate {
  if (!profile) return { ready: false, reasonKey: "no_profile", remaining: REQUIRED_STEP_KEYS.length };
  if (profile.get_ready_bypass) return { ready: true, reasonKey: "bypassed", remaining: 0 };
  if (journey?.get_ready_completed_at) return { ready: true, reasonKey: "ready", remaining: 0 };
  if (stepsDone) {
    const status = computeGetReady(stepsDone);
    if (status.complete) return { ready: true, reasonKey: "ready", remaining: 0 };
    return { ready: false, reasonKey: "not_finished", remaining: status.remainingRequired.length };
  }
  return { ready: false, reasonKey: "not_finished", remaining: REQUIRED_STEP_KEYS.length };
}
