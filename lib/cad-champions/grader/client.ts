// Grader client — SERVER ONLY. The practice upload (Get Ready step 5) grades
// through gradeSubmission(); tests use the queue (queue.ts).
//
// 1. Cheap header check on the stored file (empty / too large / not STEP):
//    fails at once without calling the grader.
// 2. Grader configured (GRADER_URL + GRADER_SECRET) and the practice-cube
//    task has a complete reference_data -> real check in practice mode
//    (single solid, units, volume within 1 %).
// 3. Grader not configured -> header-only pass (stub: true), as before.
//    Reference missing ([TODO-MO] answer data not supplied yet) -> header-only
//    pass with referenceMissing: true, so the UI says "basic check only".
// 4. Grader error after its retry -> "unavailable" (not the student's fault).

import { createServiceClient } from "@/lib/supabase/service";

import { readObjectHead } from "../upload/server";
import { DEFAULT_MAX_BYTES, isStepHeader } from "../upload/validate";
import { isGraderErrorCode, type GraderErrorCode } from "./error-codes";
import { graderConfigured } from "./http";
import { isReferenceComplete, type AspectLite, type StudentGradeResult } from "./mapping";
import { gradeSubmissionNow, type GradeTask } from "./service";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/grader/client.ts is server-only");

export const PRACTICE_TEST_SLUG = "practice-cube";

export type GradeInput = {
  mode: "practice";
  bucket: string;
  /** Object path inside the bucket (already checked to belong to the student). */
  path: string;
};

export type GradeResult =
  | {
      status: "passed";
      stub: boolean;
      /** The practice task has no answer data yet: only the header was checked. */
      referenceMissing?: boolean;
      result?: StudentGradeResult;
    }
  | {
      status: "failed";
      /** null = the file was read but did not match (see feedback). */
      errorCode: GraderErrorCode | null;
      stub: boolean;
      feedbackEn?: string;
      feedbackAr?: string;
      helpSlug?: string | null;
      result?: StudentGradeResult;
    }
  /** The grader could not run (file missing, service key missing, network). Not the student's fault. */
  | { status: "unavailable" };

/** The practice-cube task with its aspects (service role; answers never leave the server). */
async function loadPracticeTask(): Promise<GradeTask | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data: test } = await service.from("cc_tests").select("id").eq("slug", PRACTICE_TEST_SLUG).maybeSingle<{ id: string }>();
  if (!test) return null;
  const { data: task } = await service
    .from("cc_test_tasks")
    .select("id,max_points,reference_data,tolerances,density_kg_m3")
    .eq("test_id", test.id)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; max_points: number; reference_data: unknown; tolerances: unknown; density_kg_m3: number | null }>();
  if (!task) return null;
  const { data: aspects } = await service.from("cc_task_aspects").select("id,check_key,max_points,method").eq("task_id", task.id);
  return {
    id: task.id,
    max_points: Number(task.max_points) || 0,
    reference_data: task.reference_data,
    tolerances: task.tolerances,
    density_kg_m3: task.density_kg_m3,
    aspects: ((aspects ?? []) as AspectLite[]).map((a) => ({ ...a, max_points: Number(a.max_points) })),
  };
}

export async function gradeSubmission(input: GradeInput): Promise<GradeResult> {
  const head = await readObjectHead(input.bucket, input.path);
  if (!head.ok) return { status: "unavailable" };
  if (head.size <= 0) return { status: "failed", errorCode: "E_EMPTY", stub: true };
  if (head.size > DEFAULT_MAX_BYTES) return { status: "failed", errorCode: "E_TOO_LARGE", stub: true };
  if (!isStepHeader(head.head)) return { status: "failed", errorCode: "E_NOT_STEP", stub: true };

  if (!graderConfigured()) return { status: "passed", stub: true };

  const task = await loadPracticeTask();
  if (!task || !isReferenceComplete(task.reference_data)) {
    console.warn("[cc-grader] practice-cube reference_data incomplete; header-only check");
    return { status: "passed", stub: true, referenceMissing: true };
  }

  const out = await gradeSubmissionNow({ file: { bucket: input.bucket, path: input.path }, mode: "practice", task });
  if (!out.ok) {
    console.error("[cc-grader] practice grade failed:", out.reason, out.error);
    return { status: "unavailable" };
  }
  const r = out.result;
  if (r.passed) return { status: "passed", stub: false, result: r };
  return {
    status: "failed",
    errorCode: r.errorCode && isGraderErrorCode(r.errorCode) ? r.errorCode : null,
    stub: false,
    feedbackEn: r.feedbackEn,
    feedbackAr: r.feedbackAr,
    helpSlug: r.helpSlug,
    result: r,
  };
}
