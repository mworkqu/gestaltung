import { getCcUser } from "@/lib/cad-champions/auth/server";
import { closeIfExpired, loadAttemptById } from "@/lib/cad-champions/test/server";
import { liveTaskState } from "@/lib/cad-champions/test/status";
import { createServiceClient } from "@/lib/supabase/service";

// Live status of one attempt for the "Test submitted" screen (polled every
// 5 s). Session-checked: the attempt's owner or staff. Also the server-side
// half of auto-submit: an attempt past deadline + grace is closed here.

export const dynamic = "force-dynamic";
// An auto-submit here grades in after() within this budget.
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cc = await getCcUser();
  if (!cc) return Response.json({ error: "signed_out" }, { status: 401, headers: NO_STORE });

  const found = await loadAttemptById(id);
  if (!found || (found.user_id !== cc.user.id && !cc.isStaff)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const service = createServiceClient();
  if (!service) return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });

  try {
    const { data: test } = await service.from("cc_tests").select("type,grace_seconds").eq("id", found.test_id).maybeSingle<{ type: string; grace_seconds: number }>();
    const attempt = test ? await closeIfExpired(found, test) : found;

    const [tasksRes, resultsRes, subsRes] = await Promise.all([
      service.from("cc_test_tasks").select("id,grading_mode,position").eq("test_id", attempt.test_id).order("position"),
      service.from("cc_task_results").select("task_id,status,submission_id").eq("attempt_id", attempt.id),
      service.from("cc_submissions").select("task_id").eq("attempt_id", attempt.id),
    ]);
    const results = new Map(((resultsRes.data ?? []) as { task_id: string; status: string; submission_id: string | null }[]).map((r) => [r.task_id, r]));
    const subs = (subsRes.data ?? []) as { task_id: string | null }[];
    const hasPackage = subs.some((s) => s.task_id == null);
    const uploaded = new Set(subs.map((s) => s.task_id).filter(Boolean) as string[]);

    const tasks = ((tasksRes.data ?? []) as { id: string; grading_mode: string }[]).map((t) => {
      const r = results.get(t.id);
      const hasFile = r ? r.submission_id != null : uploaded.has(t.id) || hasPackage;
      return { id: t.id, state: liveTaskState({ hasFile, resultStatus: r?.status ?? null, gradingMode: t.grading_mode }) };
    });

    return Response.json({ status: attempt.status, submittedAt: attempt.submitted_at, tasks }, { headers: NO_STORE });
  } catch (e) {
    console.error("[cc-test] status failed:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "error" }, { status: 500, headers: NO_STORE });
  }
}
