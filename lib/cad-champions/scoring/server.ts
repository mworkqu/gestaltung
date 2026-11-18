// Attempt scoring — SERVER ONLY (service role). The grader calls
// computeAttemptScores(attemptId) after it writes task / aspect results, and
// the trainer review (Prompt 8) calls it again after a review. Safe to call
// any number of times: it recomputes everything from the rows.
//
// What it does:
//   1. loads the attempt, its test's tasks, the marking aspects (with the
//      staff-only partial_rule), the task results and the aspect results;
//   2. scores them (core.ts: aspects, re-normalised official weights);
//   3. writes cc_skill_scores for all six areas (assessed = false for areas
//      the test did not cover);
//   4. updates the attempt: total/max/percent/band and status
//        grading     an auto-checked file is still with the grader
//        provisional a trainer still has to confirm something
//        graded      everything is final
//        expired     nothing was uploaded
//   5. emails "Your results are ready" once (status provisional or graded),
//      and "Your final score is confirmed" once when a provisional attempt
//      becomes graded (idempotent via cc_attempts.results_email_sent_at /
//      final_email_sent_at, migration 0081).
// Never throws.

import { createServiceClient } from "@/lib/supabase/service";

import type { CcAttemptStatus, CcBand } from "../db/types";
import { OFFICIAL_WEIGHTS, SKILL_AREA_IDS } from "./config";
import { scoreAttempt, type AspectInput, type AspectResultInput, type AttemptOutcome, type TaskInput, type TaskResultInput } from "./core";
import { sendFinalScoreEmail, sendResultsReadyEmail } from "./emails";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/scoring/server.ts is server-only");

export type ComputeScoresResult =
  | {
      ok: true;
      status: CcAttemptStatus;
      outcome: AttemptOutcome;
      percent: number | null;
      band: CcBand | null;
      /** Which email this call sent, if any. */
      emailed: "results" | "final" | null;
    }
  | { ok: false; reason: "unavailable" | "not_found" | "not_finished" | "error" };

const STATUS_FOR: Record<AttemptOutcome, CcAttemptStatus> = {
  grading: "grading",
  provisional: "provisional",
  graded: "graded",
  no_files: "expired",
};

type AttemptRow = {
  id: string;
  user_id: string;
  test_id: string;
  status: string;
  graded_at: string | null;
  results_email_sent_at?: string | null;
  final_email_sent_at?: string | null;
  provisional_percent?: number | null;
};

export async function computeAttemptScores(attemptId: string): Promise<ComputeScoresResult> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId ?? "")) return { ok: false, reason: "not_found" };
  const service = createServiceClient();
  if (!service) {
    console.warn("[cc-scoring] SUPABASE_SERVICE_ROLE_KEY missing; scores not computed");
    return { ok: false, reason: "unavailable" };
  }
  try {
    const { data: attempt, error: aErr } = await service.from("cc_attempts").select("*").eq("id", attemptId).maybeSingle<AttemptRow>();
    if (aErr) throw new Error(aErr.message);
    if (!attempt) return { ok: false, reason: "not_found" };
    if (attempt.status === "in_progress") return { ok: false, reason: "not_finished" };

    const [tasksRes, resultsRes, areasRes] = await Promise.all([
      service.from("cc_test_tasks").select("id,skill_area_id,competition_module,max_points,grading_mode").eq("test_id", attempt.test_id),
      service
        .from("cc_task_results")
        .select("id,task_id,status,submission_id,final_score,manual_score,ai_score,auto_score,needs_manual_review")
        .eq("attempt_id", attemptId),
      service.from("cc_skill_areas").select("id,weight_percent"),
    ]);
    if (tasksRes.error) throw new Error(tasksRes.error.message);
    if (resultsRes.error) throw new Error(resultsRes.error.message);

    const tasks = (tasksRes.data ?? []) as TaskInput[];
    const results = (resultsRes.data ?? []) as (TaskResultInput & { id: string })[];
    const taskIds = tasks.map((t) => t.id);
    const resultIds = results.map((r) => r.id);

    const [aspectsRes, aspectResultsRes] = await Promise.all([
      taskIds.length
        ? service.from("cc_task_aspects").select("id,task_id,skill_area_id,competition_module,type,max_points,partial_rule").in("task_id", taskIds)
        : Promise.resolve({ data: [], error: null }),
      resultIds.length
        ? service.from("cc_aspect_results").select("aspect_id,passed,judgement_score,points_awarded").in("task_result_id", resultIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (aspectsRes.error) throw new Error(aspectsRes.error.message);
    if (aspectResultsRes.error) throw new Error(aspectResultsRes.error.message);

    const weights: Record<number, number> = { ...OFFICIAL_WEIGHTS };
    for (const a of (areasRes.data ?? []) as { id: number; weight_percent: number | string }[]) {
      const w = Number(a.weight_percent);
      if (Number.isFinite(w)) weights[Number(a.id)] = w;
    }

    const scores = scoreAttempt({
      tasks,
      aspects: (aspectsRes.data ?? []) as AspectInput[],
      aspectResults: (aspectResultsRes.data ?? []) as AspectResultInput[],
      results,
      weights,
    });

    // 3. skill scores (all six areas)
    const skillRows = SKILL_AREA_IDS.map((id) => {
      const a = scores.areas.find((x) => x.skillAreaId === id)!;
      return {
        attempt_id: attemptId,
        skill_area_id: id,
        user_id: attempt.user_id,
        earned_points: a.assessed ? a.earned : null,
        max_points: a.assessed ? a.max : null,
        percent: a.percent,
        level: a.level,
        assessed: a.assessed,
      };
    });
    const { error: sErr } = await service.from("cc_skill_scores").upsert(skillRows, { onConflict: "attempt_id,skill_area_id" });
    if (sErr) throw new Error(sErr.message);

    // 4. attempt
    const status = STATUS_FOR[scores.outcome];
    const noFiles = scores.outcome === "no_files";
    const update: Record<string, unknown> = {
      status,
      total_score: scores.totalEarned,
      max_score: scores.totalMax,
      percent: noFiles ? null : scores.overall,
      band: noFiles ? null : scores.band,
      graded_at: status === "graded" ? (attempt.graded_at ?? new Date().toISOString()) : null,
    };
    const { error: uErr } = await service.from("cc_attempts").update(update).eq("id", attemptId);
    if (uErr) throw new Error(uErr.message);

    // 5. emails (each send claims its own column; a failure never fails scoring)
    let emailed: "results" | "final" | null = null;
    if (status === "provisional" || status === "graded") {
      if (!attempt.results_email_sent_at) {
        if (await sendResultsReadyEmail(attemptId)) emailed = "results";
      } else if (status === "graded" && attempt.provisional_percent != null && !attempt.final_email_sent_at) {
        if (await sendFinalScoreEmail(attemptId)) emailed = "final";
      }
    }

    return { ok: true, status, outcome: scores.outcome, percent: noFiles ? null : scores.overall, band: noFiles ? null : scores.band, emailed };
  } catch (e) {
    console.error("[cc-scoring] compute failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
