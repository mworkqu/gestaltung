// Grading queue — SERVER ONLY (service role). Called once when an attempt is
// submitted (manual, timeout or admin).
//
// ============================================================================
// STUB until Prompt 6. Prompt 6 replaces the body of enqueueGrading() with a
// call to the STEP grader service (and the AI drawing check in Prompt 8).
// Keep the signature so callers do not change. For now it only:
//   - creates one cc_task_results row per task with status 'pending'
//     (submission_id = the task's file, or the attempt's package ZIP, or null
//     when nothing was uploaded), and
//   - moves the attempt from 'submitted' to 'grading'.
// ============================================================================

import { createServiceClient } from "@/lib/supabase/service";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/grader/queue.ts is server-only");

export type EnqueueResult = { ok: true; tasks: number } | { ok: false; reason: "unavailable" | "not_found" | "error" };

export async function enqueueGrading(attemptId: string): Promise<EnqueueResult> {
  const service = createServiceClient();
  if (!service) {
    console.warn("[cc-grader] SUPABASE_SERVICE_ROLE_KEY missing; grading not queued");
    return { ok: false, reason: "unavailable" };
  }
  try {
    const { data: attempt, error: aErr } = await service
      .from("cc_attempts")
      .select("id,user_id,test_id,status")
      .eq("id", attemptId)
      .maybeSingle<{ id: string; user_id: string; test_id: string; status: string }>();
    if (aErr) throw new Error(aErr.message);
    if (!attempt) return { ok: false, reason: "not_found" };

    const [tasksRes, subsRes] = await Promise.all([
      service.from("cc_test_tasks").select("id,max_points").eq("test_id", attempt.test_id),
      service.from("cc_submissions").select("id,task_id").eq("attempt_id", attemptId),
    ]);
    if (tasksRes.error) throw new Error(tasksRes.error.message);
    if (subsRes.error) throw new Error(subsRes.error.message);

    const subs = (subsRes.data ?? []) as { id: string; task_id: string | null }[];
    const packageSub = subs.find((s) => s.task_id == null) ?? null;
    const rows = ((tasksRes.data ?? []) as { id: string; max_points: number }[]).map((t) => ({
      attempt_id: attemptId,
      task_id: t.id,
      user_id: attempt.user_id,
      submission_id: subs.find((s) => s.task_id === t.id)?.id ?? packageSub?.id ?? null,
      max_points: t.max_points,
      status: "pending",
    }));

    if (rows.length > 0) {
      const { error } = await service.from("cc_task_results").upsert(rows, { onConflict: "attempt_id,task_id" });
      if (error) throw new Error(error.message);
    }

    const { error: uErr } = await service
      .from("cc_attempts")
      .update({ status: "grading" })
      .eq("id", attemptId)
      .in("status", ["submitted", "grading"]);
    if (uErr) throw new Error(uErr.message);

    return { ok: true, tasks: rows.length };
  } catch (e) {
    console.error("[cc-grader] enqueue failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
