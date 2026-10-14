// Grader client — SERVER ONLY. The one entry point every caller uses to grade
// a submission (practice upload now; tests in Prompt 5).
//
// ============================================================================
// STUB until Prompt 6. Prompt 6 replaces the body of gradeSubmission() with a
// call to the real STEP grader service (volume, single solid, units, inertia).
// Keep the signature and the GradeResult shape so callers do not change.
// For now: practice passes when the stored file is non-empty and starts with
// "ISO-10303-21"; otherwise E_EMPTY / E_NOT_STEP / E_TOO_LARGE.
// ============================================================================

import { readObjectHead } from "../upload/server";
import { DEFAULT_MAX_BYTES, isStepHeader } from "../upload/validate";
import type { GraderErrorCode } from "./error-codes";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/grader/client.ts is server-only");

export type GradeInput = {
  mode: "practice";
  bucket: string;
  /** Object path inside the bucket (already checked to belong to the student). */
  path: string;
};

export type GradeResult =
  | { status: "passed"; stub: boolean }
  | { status: "failed"; errorCode: GraderErrorCode; stub: boolean }
  /** The grader could not run (file missing, service key missing, network). Not the student's fault. */
  | { status: "unavailable" };

export async function gradeSubmission(input: GradeInput): Promise<GradeResult> {
  // STUB until Prompt 6.
  const head = await readObjectHead(input.bucket, input.path);
  if (!head.ok) return { status: "unavailable" };
  if (head.size <= 0) return { status: "failed", errorCode: "E_EMPTY", stub: true };
  if (head.size > DEFAULT_MAX_BYTES) return { status: "failed", errorCode: "E_TOO_LARGE", stub: true };
  if (!isStepHeader(head.head)) return { status: "failed", errorCode: "E_NOT_STEP", stub: true };
  return { status: "passed", stub: true };
}
