"use server";

// Get Ready server actions. Every action checks the CC session itself and only
// ever writes rows for the signed-in user.

import type { Locale } from "@/i18n/routing";

import { getCcUser } from "../auth/server";
import { gradeSubmission } from "../grader/client";
import { graderErrorInfo, type GraderErrorCode } from "../grader/error-codes";
import { markJourney } from "../journey/server";
import { isCcLocale } from "../routes";
import { isPathUnderPrefix } from "../upload/validate";
import { markStepDone, setSubItem } from "./server";
import { MANUALLY_MARKABLE, getStepDef, isGetReadyStepKey } from "./steps";

export type GetReadyActionResult =
  | { ok: true; keys: string[]; complete: boolean; justCompleted: boolean }
  | { ok: false; reason: "signed_out" | "not_allowed" | "not_set_up" | "error" };

export type PracticeResult =
  | { ok: true; outcome: "passed"; keys: string[]; complete: boolean; justCompleted: boolean; basicCheckOnly: boolean }
  | { ok: true; outcome: "failed"; errorCode: GraderErrorCode | null; message: string; helpSlug: string | null }
  | { ok: false; reason: "signed_out" | "not_allowed" | "unavailable" | "not_set_up" | "error" };

/** The practice upload folder; UploadBox gets the same prefix. */
const practicePrefix = (userId: string) => `${userId}/practice/`;
const PRACTICE_BUCKET = "cc-submissions";

/** "Mark as done" / "Mark as watched" / end of the demo. */
export async function markGetReadyStepAction(stepKey: string): Promise<GetReadyActionResult> {
  const cc = await getCcUser();
  if (!cc?.profile) return { ok: false, reason: "signed_out" };
  if (!isGetReadyStepKey(stepKey) || !MANUALLY_MARKABLE.includes(stepKey)) return { ok: false, reason: "not_allowed" };
  return markStepDone(cc.user.id, stepKey);
}

/** Ticks or unticks one checklist box (essential actions, test-day checklist). */
export async function setGetReadyTickAction(stepKey: string, subKey: string, checked: boolean): Promise<GetReadyActionResult> {
  const cc = await getCcUser();
  if (!cc?.profile) return { ok: false, reason: "signed_out" };
  if (!isGetReadyStepKey(stepKey) || getStepDef(stepKey).autoComplete !== "checklist" || typeof checked !== "boolean") {
    return { ok: false, reason: "not_allowed" };
  }
  return setSubItem(cc.user.id, stepKey, subKey, checked);
}

/** Grades an uploaded practice file; on a pass stamps practice_passed_at and finishes step 5. */
export async function gradePracticeAction(path: string, locale: string): Promise<PracticeResult> {
  const cc = await getCcUser();
  if (!cc?.profile) return { ok: false, reason: "signed_out" };
  const userId = cc.user.id;
  if (!isPathUnderPrefix(path, practicePrefix(userId))) return { ok: false, reason: "not_allowed" };
  const loc: Locale = isCcLocale(locale) ? locale : "en";

  const result = await gradeSubmission({ mode: "practice", bucket: PRACTICE_BUCKET, path });
  if (result.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (result.status === "failed") {
    if (result.errorCode) {
      const info = graderErrorInfo(result.errorCode, loc);
      return { ok: true, outcome: "failed", errorCode: result.errorCode, message: info.message, helpSlug: info.helpSlug ?? null };
    }
    // Read fine but did not match (e.g. volume off): the grader's own guidance, never the answer.
    const message = (loc === "ar" ? result.feedbackAr : result.feedbackEn) || graderErrorInfo("", loc).message;
    return { ok: true, outcome: "failed", errorCode: null, message, helpSlug: result.helpSlug ?? null };
  }

  await markJourney(userId, "practice_passed_at");
  const step = await markStepDone(userId, "practice_upload");
  if (!step.ok) return step;
  return {
    ok: true,
    outcome: "passed",
    keys: step.keys,
    complete: step.complete,
    justCompleted: step.justCompleted,
    basicCheckOnly: result.referenceMissing === true,
  };
}
