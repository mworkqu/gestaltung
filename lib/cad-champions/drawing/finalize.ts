// "Finalize" a trainer review — SERVER ONLY (service role). The server action
// (admin/review/actions.ts) checks that the caller is staff first.
//
// 1. loads the task result and every aspect of its task
// 2. finalizeRows(): every aspect needs a decision (pass/fail, 0-3)
// 3. replaces the cc_aspect_results rows (graded_by, graded_at; the AI's
//    feedback text is kept)
// 4. cc_task_results: manual_score, final_score, status final, comment
//    (en / ar, machine-translated flag), graded_by / graded_at
// 5. cc_audit_log row (before / after)
// 6. computeAttemptScores(): skill scores, attempt status; it emails "Your
//    final score is confirmed" once the whole attempt is graded

import { createServiceClient } from "@/lib/supabase/service";

import { computeAttemptScores } from "../scoring/server";
import { COMMENT_MAX, finalizeRows, type Decision } from "./review";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/drawing/finalize.ts is server-only");

export interface FinalizeInput {
  taskResultId: string;
  actorId: string;
  decisions: Decision[];
  commentEn: string;
  commentAr: string;
  /** Which language field holds a machine translation (null = none). */
  machineTranslated: "en" | "ar" | null;
}

export type FinalizeResult =
  | { ok: true; attemptId: string; finalScore: number; maxPoints: number; attemptStatus: string | null; emailed: boolean }
  | { ok: false; error: "unavailable" | "not_found" | "not_reviewable" | "incomplete" | "too_long" | "error"; missing?: string[] };

const REVIEWABLE = new Set(["ai_pending_review", "pending", "error", "final"]);

export async function finalizeReview(input: FinalizeInput): Promise<FinalizeResult> {
  if (!/^[0-9a-f-]{36}$/i.test(input.taskResultId ?? "")) return { ok: false, error: "not_found" };
  const commentEn = (input.commentEn ?? "").trim();
  const commentAr = (input.commentAr ?? "").trim();
  if (commentEn.length > COMMENT_MAX || commentAr.length > COMMENT_MAX) return { ok: false, error: "too_long" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "unavailable" };
  try {
    const { data: r, error } = await service
      .from("cc_task_results")
      .select("id,attempt_id,task_id,user_id,status,submission_id,manual_score,final_score,details,reviewer_comment_en,reviewer_comment_ar")
      .eq("id", input.taskResultId)
      .maybeSingle<{
        id: string;
        attempt_id: string;
        task_id: string;
        user_id: string;
        status: string;
        submission_id: string | null;
        manual_score: number | null;
        final_score: number | null;
        details: Record<string, unknown> | null;
        reviewer_comment_en: string | null;
        reviewer_comment_ar: string | null;
      }>();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, error: "not_found" };
    if (!r.submission_id || !REVIEWABLE.has(r.status)) return { ok: false, error: "not_reviewable" };

    const { data: aspectRows, error: aErr } = await service.from("cc_task_aspects").select("id,type,method,max_points").eq("task_id", r.task_id);
    if (aErr) throw new Error(aErr.message);
    const aspects = (aspectRows ?? []) as { id: string; type: string; method: string; max_points: number | string }[];
    const computed = finalizeRows(aspects, input.decisions);
    if (!computed.ok) return { ok: false, error: "incomplete", missing: computed.missing };

    const { data: oldRows } = await service.from("cc_aspect_results").select("aspect_id,passed,judgement_score,points_awarded,feedback_en,feedback_ar").eq("task_result_id", r.id);
    const old = new Map(((oldRows ?? []) as { aspect_id: string; feedback_en: string | null; feedback_ar: string | null }[]).map((o) => [o.aspect_id, o]));

    const at = new Date().toISOString();
    if (aspects.length > 0) {
      const del = await service.from("cc_aspect_results").delete().eq("task_result_id", r.id).in("aspect_id", aspects.map((a) => a.id));
      if (del.error) throw new Error(del.error.message);
      const ins = await service.from("cc_aspect_results").insert(
        computed.rows.map((row) => ({
          task_result_id: r.id,
          aspect_id: row.aspect_id,
          user_id: r.user_id,
          passed: row.passed,
          judgement_score: row.judgement_score,
          points_awarded: row.points_awarded,
          feedback_en: old.get(row.aspect_id)?.feedback_en ?? null,
          feedback_ar: old.get(row.aspect_id)?.feedback_ar ?? null,
          graded_by: input.actorId,
          graded_at: at,
        }))
      );
      if (ins.error) throw new Error(ins.error.message);
    }

    const details = { ...(r.details ?? {}), reviewed_at: at, comment_machine_translated: commentEn && commentAr ? input.machineTranslated : null };
    const after = {
      status: "final",
      manual_score: computed.manualScore,
      final_score: computed.finalScore,
      needs_manual_review: false,
      reviewer_comment_en: commentEn || null,
      reviewer_comment_ar: commentAr || null,
      graded_by: input.actorId,
      graded_at: at,
      details,
    };
    const { error: uErr } = await service.from("cc_task_results").update(after).eq("id", r.id);
    if (uErr) throw new Error(uErr.message);

    const { error: logErr } = await service.from("cc_audit_log").insert({
      actor_id: input.actorId,
      action: r.status === "final" ? "review.refinalize" : "review.finalize",
      entity_type: "cc_task_results",
      entity_id: r.id,
      before: { status: r.status, manual_score: r.manual_score, final_score: r.final_score, aspects: oldRows ?? [] },
      after: { status: "final", manual_score: computed.manualScore, final_score: computed.finalScore, aspects: computed.rows, comment_en: commentEn || null, comment_ar: commentAr || null },
    });
    if (logErr) console.error("[cc-review] audit insert failed:", logErr.code ?? logErr.message);

    const scored = await computeAttemptScores(r.attempt_id);
    if (!scored.ok) console.error("[cc-review] computeAttemptScores:", scored.reason);
    return {
      ok: true,
      attemptId: r.attempt_id,
      finalScore: computed.finalScore,
      maxPoints: computed.maxPoints,
      attemptStatus: scored.ok ? scored.status : null,
      emailed: scored.ok && scored.emailed === "final",
    };
  } catch (e) {
    console.error("[cc-review] finalize failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}
