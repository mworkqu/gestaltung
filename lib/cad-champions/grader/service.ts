// Grades one STEP file now — SERVER ONLY (service role). Used by the queue
// (tests), the practice upload and, later, exercises.
//
// 1. finds the stored file (submission id, or bucket + path)
// 2. creates a 10-minute signed URL
// 3. POST /grade (http.ts: 120 s timeout, one retry on network error / 5xx)
// 4. E_DOWNLOAD_FAILED (the grader could not fetch the URL) -> one more try
//    with a fresh URL, then "download_failed" (manual review, not the student's fault)
// 5. returns a student-safe result + per-aspect outcomes, and the raw
//    response for cc_grading_logs only.

import { createServiceClient } from "@/lib/supabase/service";

import { callGrader, graderConfigured, type GraderGradeResponse } from "./http";
import {
  aspectOutcomes,
  autoScoreFor,
  graderAspectsFor,
  isReferenceComplete,
  scoringFor,
  toStudentResult,
  type AspectLite,
  type AspectOutcome,
  type GraderMode,
  type StudentGradeResult,
} from "./mapping";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/grader/service.ts is server-only");

export const SUBMISSIONS_BUCKET = "cc-submissions";
export const SIGNED_URL_SECONDS = 600;
const DEFAULT_DENSITY = 7850;

export interface GradeTask {
  id: string;
  max_points: number;
  reference_data: unknown;
  tolerances: unknown;
  density_kg_m3: number | null;
  aspects: AspectLite[];
}

export type GradeNowInput = {
  mode: GraderMode;
  task: GradeTask;
  /** Used as the grader's submission_id in its logs. */
  logId?: string;
} & ({ submissionId: string } | { file: { bucket: string; path: string } });

export type GradeNowFailure = "not_configured" | "reference_missing" | "file_missing" | "download_failed" | "grader_error" | "unavailable";

export type GradeNowOutcome =
  | {
      ok: true;
      result: StudentGradeResult;
      aspects: AspectOutcome[];
      /** Full grader JSON (incl. details): cc_grading_logs.response only. */
      raw: unknown;
      durationMs: number;
    }
  | { ok: false; reason: GradeNowFailure; error: string; raw?: unknown; durationMs: number };

/** Builds the /grade request body (no URL yet). Exported for the package call. */
export function gradeRequestBody(task: GradeTask, mode: GraderMode) {
  const tolerances = task.tolerances && typeof task.tolerances === "object" && !Array.isArray(task.tolerances) ? task.tolerances : undefined;
  const aspects = scoringFor(mode) === "aspects" ? graderAspectsFor(task.aspects, mode) : [];
  return {
    mode,
    scoring: scoringFor(mode),
    reference_data: task.reference_data,
    density_kg_m3: Number(task.density_kg_m3) > 0 ? Number(task.density_kg_m3) : DEFAULT_DENSITY,
    ...(tolerances ? { tolerances } : {}),
    max_points: Math.max(0, Number(task.max_points) || 0),
    ...(aspects.length > 0 ? { aspects } : {}),
  };
}

/** Student-safe result + aspect outcomes from one grader result (also used for package results). */
export function interpretResult(task: GradeTask, mode: GraderMode, data: GraderGradeResponse) {
  const aspects = aspectOutcomes(task.aspects, data, mode);
  const score = autoScoreFor(aspects, data);
  return { result: toStudentResult(data, score), aspects };
}

async function locate(input: GradeNowInput): Promise<{ bucket: string; path: string } | null> {
  if ("file" in input) return input.file;
  const service = createServiceClient();
  if (!service) return null;
  const { data } = await service
    .from("cc_submissions")
    .select("storage_path")
    .eq("id", input.submissionId)
    .maybeSingle<{ storage_path: string }>();
  return data?.storage_path ? { bucket: SUBMISSIONS_BUCKET, path: data.storage_path } : null;
}

async function signedUrl(bucket: string, path: string): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

export async function gradeSubmissionNow(input: GradeNowInput): Promise<GradeNowOutcome> {
  const started = Date.now();
  const fail = (reason: GradeNowFailure, error: string, raw?: unknown): GradeNowOutcome => ({ ok: false, reason, error, raw, durationMs: Date.now() - started });

  if (!graderConfigured()) return fail("not_configured", "GRADER_URL / GRADER_SECRET not set");
  if (!isReferenceComplete(input.task.reference_data)) return fail("reference_missing", "task reference_data is incomplete");
  if (!createServiceClient()) return fail("unavailable", "SUPABASE_SERVICE_ROLE_KEY missing");

  const where = await locate(input);
  if (!where) return fail("file_missing", "submission file not found");

  const body = gradeRequestBody(input.task, input.mode);
  const logId = input.logId ?? ("submissionId" in input ? input.submissionId : input.file.path.slice(-120));

  let lastRaw: unknown;
  for (let round = 0; round < 2; round++) {
    const url = await signedUrl(where.bucket, where.path);
    if (!url) return fail("file_missing", "could not sign the file URL");
    const res = await callGrader("/grade", { ...body, submission_id: logId, file_url: url });
    if (!res.ok) return fail(res.kind === "not_configured" ? "not_configured" : "grader_error", res.error, res.raw);
    lastRaw = res.raw;
    if (res.data.error_code === "E_DOWNLOAD_FAILED") continue; // fresh URL, one more try
    const { result, aspects } = interpretResult(input.task, input.mode, res.data);
    return { ok: true, result, aspects, raw: res.raw, durationMs: Date.now() - started };
  }
  return fail("download_failed", "grader could not download the file (E_DOWNLOAD_FAILED twice)", lastRaw);
}
