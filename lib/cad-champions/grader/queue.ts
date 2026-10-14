// Grading queue — SERVER ONLY (service role). Runs once an attempt is
// submitted (manual, timeout or admin), from Next `after()` in
// finalizeAttempt (test/server.ts), so the submit response returns at once.
//
// enqueueGrading(attemptId):
//   1. loads the attempt, its test, tasks, aspects, submissions and results
//   2. planGrading() (plan.ts) decides per task; tasks already graded are
//      skipped, so calling it twice is safe
//   3. writes placeholders: pending (to grade / trainer), ai_pending_review
//      (drawings; Prompt 8 does the AI check), auto 0 points (no file)
//   4. grades STEP files: per_task -> /grade (max 4 at a time);
//      module_package -> the ZIP's STEP files go to /grade-package
//   5. writes cc_task_results (+ student-safe details), cc_aspect_results and
//      cc_grading_logs (raw response, staff only)
//   6. grader not configured / still failing after the retry -> status
//      error + needs_manual_review (the student sees "We're checking this
//      file manually - no action needed.")
//   7. every task has a result -> computeAttemptScores(attemptId) (Prompt 7)

import { computeAttemptScores } from "@/lib/cad-champions/scoring/server";
import { createServiceClient } from "@/lib/supabase/service";

import { parseExpectations } from "../upload/package-check";
import { readZipEntries } from "../upload/zip-manifest";
import { openStoredZip } from "../upload/zip-remote";
import { DEFAULT_MAX_BYTES } from "../upload/validate";
import { callGrader, graderConfigured, type GraderGradeResponse } from "./http";
import { isReferenceComplete, studentDetails, type AspectLite, type AspectOutcome, type GraderMode, type StudentGradeResult } from "./mapping";
import { GRADER_CONCURRENCY, mapLimit, planGrading, readyForScoring, selectPackageSteps, type TaskAction } from "./plan";
import { SIGNED_URL_SECONDS, SUBMISSIONS_BUCKET, gradeRequestBody, gradeSubmissionNow, interpretResult, type GradeTask } from "./service";
import { readZipEntryData } from "./zip-extract";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/grader/queue.ts is server-only");

export type EnqueueResult = { ok: true; tasks: number } | { ok: false; reason: "unavailable" | "not_found" | "error" };

type Service = NonNullable<ReturnType<typeof createServiceClient>>;

interface TaskRow {
  id: string;
  max_points: number;
  grading_mode: string;
  grader_mode: string | null;
  reference_data: unknown;
  tolerances: unknown;
  density_kg_m3: number | null;
}

interface SubRow {
  id: string;
  task_id: string | null;
  storage_path: string;
}

interface Ctx {
  service: Service;
  attemptId: string;
  userId: string;
  tasks: Map<string, TaskRow>;
  aspects: Map<string, AspectLite[]>;
  resultIds: Map<string, string>;
}

const nowIso = () => new Date().toISOString();

function graderMode(t: TaskRow): GraderMode {
  return t.grader_mode === "assembly" || t.grader_mode === "practice" ? t.grader_mode : "part";
}

function gradeTask(ctx: Ctx, t: TaskRow): GradeTask {
  return {
    id: t.id,
    max_points: Number(t.max_points) || 0,
    reference_data: t.reference_data,
    tolerances: t.tolerances,
    density_kg_m3: t.density_kg_m3,
    aspects: ctx.aspects.get(t.id) ?? [],
  };
}

async function log(
  ctx: Ctx,
  row: { submission_id: string | null; task_id: string; duration_ms: number; error?: string | null; error_code?: string | null; response?: unknown }
) {
  const { error } = await ctx.service.from("cc_grading_logs").insert({
    kind: "step",
    submission_id: row.submission_id,
    task_result_id: ctx.resultIds.get(row.task_id) ?? null,
    duration_ms: Math.max(0, Math.round(row.duration_ms)),
    error: row.error ? row.error.slice(0, 1000) : null,
    error_code: row.error_code ?? null,
    response: row.response ?? null,
  });
  if (error) console.error("[cc-grader] log insert failed:", error.code ?? error.message);
}

async function writeAspects(ctx: Ctx, taskId: string, outcomes: readonly AspectOutcome[]) {
  const resultId = ctx.resultIds.get(taskId);
  if (!resultId || outcomes.length === 0) return;
  const ids = outcomes.map((o) => o.aspectId);
  // The unique index is partial (task_result_id not null), so no ON CONFLICT: replace the rows.
  const del = await ctx.service.from("cc_aspect_results").delete().eq("task_result_id", resultId).in("aspect_id", ids);
  if (del.error) console.error("[cc-grader] aspect delete failed:", del.error.code ?? del.error.message);
  const at = nowIso();
  const { error } = await ctx.service.from("cc_aspect_results").insert(
    outcomes.map((o) => ({
      task_result_id: resultId,
      aspect_id: o.aspectId,
      user_id: ctx.userId,
      passed: o.passed,
      points_awarded: o.points,
      graded_at: at,
    }))
  );
  if (error) console.error("[cc-grader] aspect insert failed:", error.code ?? error.message);
}

async function saveGraded(
  ctx: Ctx,
  taskId: string,
  submissionId: string,
  graded: { result: StudentGradeResult; aspects: AspectOutcome[] },
  meta: { raw: unknown; durationMs: number; fileName?: string | null; matchedByVolume?: boolean }
) {
  const r = graded.result;
  const { error } = await ctx.service
    .from("cc_task_results")
    .update({
      submission_id: submissionId,
      status: "auto",
      auto_score: r.score,
      final_score: r.score,
      needs_manual_review: false,
      error_code: r.errorCode,
      help_slug: r.helpSlug,
      feedback_en: r.feedbackEn || null,
      feedback_ar: r.feedbackAr || null,
      details: studentDetails(r, { fileName: meta.fileName, matchedByVolume: meta.matchedByVolume }),
      graded_at: nowIso(),
    })
    .eq("attempt_id", ctx.attemptId)
    .eq("task_id", taskId);
  if (error) console.error("[cc-grader] result update failed:", error.code ?? error.message);
  await writeAspects(ctx, taskId, graded.aspects);
  await log(ctx, { submission_id: submissionId, task_id: taskId, duration_ms: meta.durationMs, error_code: r.errorCode, response: meta.raw });
}

/** Grader unavailable / failed after the retry: a person checks the file. */
async function saveManualReview(
  ctx: Ctx,
  taskId: string,
  submissionId: string | null,
  why: { error: string; errorCode?: string | null; raw?: unknown; durationMs?: number }
) {
  const { error } = await ctx.service
    .from("cc_task_results")
    .update({
      status: "error",
      needs_manual_review: true,
      error_code: why.errorCode ?? null,
      help_slug: null,
      feedback_en: null,
      feedback_ar: null,
      details: studentDetails(null, { needsManualReview: true }),
    })
    .eq("attempt_id", ctx.attemptId)
    .eq("task_id", taskId);
  if (error) console.error("[cc-grader] manual-review update failed:", error.code ?? error.message);
  await log(ctx, { submission_id: submissionId, task_id: taskId, duration_ms: why.durationMs ?? 0, error: why.error, error_code: why.errorCode ?? null, response: why.raw });
}

// ------------------------------------------------------------------ per_task

async function gradeFiles(ctx: Ctx, actions: Extract<TaskAction, { kind: "grade_file" }>[]) {
  await mapLimit(actions, GRADER_CONCURRENCY, async (a) => {
    const t = ctx.tasks.get(a.taskId)!;
    const out = await gradeSubmissionNow({
      submissionId: a.submissionId,
      mode: graderMode(t),
      task: gradeTask(ctx, t),
      logId: ctx.resultIds.get(a.taskId) ?? a.submissionId,
    });
    if (out.ok) {
      await saveGraded(ctx, a.taskId, a.submissionId, out, { raw: out.raw, durationMs: out.durationMs });
    } else {
      await saveManualReview(ctx, a.taskId, a.submissionId, {
        error: `${out.reason}: ${out.error}`,
        errorCode: out.reason === "download_failed" ? "E_DOWNLOAD_FAILED" : null,
        raw: out.raw,
        durationMs: out.durationMs,
      });
    }
  });
}

// ------------------------------------------------------------------ module_package

type PackageFiles = { ok: true; files: { name: string; file_url: string }[] } | { ok: false; error: string };

/** Copies the ZIP's STEP files to storage (service role) and signs a URL for each. */
async function packageFiles(ctx: Ctx, sub: SubRow): Promise<PackageFiles> {
  const zip = await openStoredZip(SUBMISSIONS_BUCKET, sub.storage_path, 1800);
  if (!zip.ok) return { ok: false, error: `package zip ${zip.reason}` };
  const listing = await readZipEntries(zip.size, zip.read, { maxEntries: 500 });
  if (!listing.ok) return { ok: false, error: `package zip ${listing.reason}` };

  const steps = selectPackageSteps(listing.entries);
  const prefix = `${ctx.userId}/${ctx.attemptId}/package-step/`;
  const settled = await mapLimit(steps, GRADER_CONCURRENCY, async (s, i) => {
    const data = await readZipEntryData(s.entry, zip.read, DEFAULT_MAX_BYTES);
    if (!data.ok) return null; // left out: the grader reports E_NO_FILE for its task
    const ext = s.name.toLowerCase().endsWith(".stp") ? ".stp" : ".step";
    const path = `${prefix}${String(i + 1).padStart(2, "0")}${ext}`;
    const up = await ctx.service.storage.from(SUBMISSIONS_BUCKET).upload(path, data.bytes, { contentType: "application/step", upsert: true });
    if (up.error) throw new Error(`upload failed: ${up.error.message}`);
    const signed = await ctx.service.storage.from(SUBMISSIONS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error("sign failed");
    return { name: s.name, file_url: signed.data.signedUrl };
  });
  if (settled.some((r) => r.status === "rejected")) return { ok: false, error: "could not stage the package STEP files" };
  return { ok: true, files: settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : [])) };
}

async function gradePackage(ctx: Ctx, actions: Extract<TaskAction, { kind: "grade_package" }>[], sub: SubRow, expectationsJson: unknown) {
  if (actions.length === 0) return;
  const started = Date.now();
  const expectations = parseExpectations(expectationsJson);
  const ready: TaskRow[] = [];
  for (const a of actions) {
    const t = ctx.tasks.get(a.taskId)!;
    if (isReferenceComplete(t.reference_data)) ready.push(t);
    else await saveManualReview(ctx, t.id, sub.id, { error: "reference_missing: task reference_data is incomplete" });
  }
  if (ready.length === 0) return;

  const files = await packageFiles(ctx, sub);
  if (!files.ok) {
    for (const t of ready) await saveManualReview(ctx, t.id, sub.id, { error: files.error, durationMs: Date.now() - started });
    return;
  }

  const body = {
    submission_id: ctx.attemptId,
    density_kg_m3: 7850,
    files: files.files,
    tasks: ready.map((t) => ({
      task_id: t.id,
      patterns: expectations.tasks.find((e) => e.taskId === t.id)?.patterns ?? [],
      ...gradeRequestBody(gradeTask(ctx, t), graderMode(t)),
    })),
  };
  const res = await callGrader("/grade-package", body);
  const durationMs = Date.now() - started;
  if (!res.ok) {
    for (const t of ready) await saveManualReview(ctx, t.id, sub.id, { error: `${res.kind}: ${res.error}`, raw: res.raw, durationMs });
    return;
  }
  const byTask = new Map(res.data.results.map((r) => [r.task_id, r]));
  for (const t of ready) {
    const r = byTask.get(t.id);
    const raw = r ? { ...r, unmatched_files: res.data.unmatched_files, ignored_files: res.data.ignored_files } : res.raw;
    if (!r) {
      await saveManualReview(ctx, t.id, sub.id, { error: "grader returned no result for this task", raw, durationMs });
    } else if (r.error_code === "E_DOWNLOAD_FAILED") {
      await saveManualReview(ctx, t.id, sub.id, { error: "grader could not download the file", errorCode: "E_DOWNLOAD_FAILED", raw, durationMs });
    } else {
      const graded = interpretResult(gradeTask(ctx, t), graderMode(t), r as GraderGradeResponse);
      await saveGraded(ctx, t.id, sub.id, graded, { raw, durationMs, fileName: r.file_name ?? null, matchedByVolume: !!r.matched_by_volume });
    }
  }
}

// ------------------------------------------------------------------ entry

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

    const [testRes, tasksRes, subsRes, resultsRes] = await Promise.all([
      service.from("cc_tests").select("upload_mode,package_expectations").eq("id", attempt.test_id).maybeSingle<{ upload_mode: string; package_expectations: unknown }>(),
      service
        .from("cc_test_tasks")
        .select("id,max_points,grading_mode,grader_mode,reference_data,tolerances,density_kg_m3")
        .eq("test_id", attempt.test_id)
        .order("position", { ascending: true }),
      service.from("cc_submissions").select("id,task_id,storage_path").eq("attempt_id", attemptId),
      service.from("cc_task_results").select("id,task_id,status").eq("attempt_id", attemptId),
    ]);
    for (const r of [testRes, tasksRes, subsRes, resultsRes]) if (r.error) throw new Error(r.error.message);
    const tasks = (tasksRes.data ?? []) as TaskRow[];
    const subs = (subsRes.data ?? []) as SubRow[];
    const existing = (resultsRes.data ?? []) as { id: string; task_id: string; status: string }[];
    const uploadMode = testRes.data?.upload_mode ?? "per_task";

    const aspects = new Map<string, AspectLite[]>();
    if (tasks.length > 0) {
      const { data: aRows, error } = await service
        .from("cc_task_aspects")
        .select("id,task_id,check_key,max_points,method")
        .in(
          "task_id",
          tasks.map((t) => t.id)
        );
      if (error) throw new Error(error.message);
      for (const a of (aRows ?? []) as (AspectLite & { task_id: string })[]) {
        aspects.set(a.task_id, [...(aspects.get(a.task_id) ?? []), { id: a.id, check_key: a.check_key, max_points: Number(a.max_points), method: a.method }]);
      }
    }

    const plan = planGrading({ uploadMode, tasks, submissions: subs, results: existing });
    const work = plan.filter((a) => a.kind !== "skip");

    // Placeholder / final rows for every task we act on.
    const at = nowIso();
    const rows = work.map((a) => {
      const t = tasks.find((x) => x.id === a.taskId)!;
      const base = {
        attempt_id: attemptId,
        task_id: a.taskId,
        user_id: attempt.user_id,
        max_points: t.max_points,
        needs_manual_review: false,
        error_code: null,
        help_slug: null,
        feedback_en: null,
        feedback_ar: null,
      };
      switch (a.kind) {
        case "no_file":
          return { ...base, submission_id: null, status: "auto", auto_score: 0, final_score: 0, details: { no_file: true }, graded_at: at };
        case "ai_placeholder":
          return { ...base, submission_id: a.submissionId, status: "ai_pending_review", details: {} };
        case "manual_pending":
          return { ...base, submission_id: a.submissionId, status: "pending", details: {} };
        default:
          return { ...base, submission_id: a.submissionId, status: "pending", details: {} };
      }
    });

    const ctx: Ctx = { service, attemptId, userId: attempt.user_id, tasks: new Map(tasks.map((t) => [t.id, t])), aspects, resultIds: new Map(existing.map((r) => [r.task_id, r.id])) };

    if (rows.length > 0) {
      const { data: saved, error } = await service.from("cc_task_results").upsert(rows, { onConflict: "attempt_id,task_id" }).select("id,task_id");
      if (error) throw new Error(error.message);
      for (const r of (saved ?? []) as { id: string; task_id: string }[]) ctx.resultIds.set(r.task_id, r.id);
    }

    const { error: uErr } = await service.from("cc_attempts").update({ status: "grading" }).eq("id", attemptId).in("status", ["submitted", "grading"]);
    if (uErr) throw new Error(uErr.message);

    // No file: every auto aspect of the task is failed with 0 points.
    for (const a of work) {
      if (a.kind !== "no_file") continue;
      const list = (aspects.get(a.taskId) ?? []).filter((x) => x.method === "auto_step");
      await writeAspects(
        ctx,
        a.taskId,
        list.map((x) => ({ aspectId: x.id, passed: false, points: 0, maxPoints: Number(x.max_points) || 0 }))
      );
    }

    const files = work.filter((a): a is Extract<TaskAction, { kind: "grade_file" }> => a.kind === "grade_file");
    const pkg = work.filter((a): a is Extract<TaskAction, { kind: "grade_package" }> => a.kind === "grade_package");

    if (!graderConfigured()) {
      if (files.length + pkg.length > 0) console.warn("[cc-grader] GRADER_URL / GRADER_SECRET not set; STEP files go to manual review");
      for (const a of [...files, ...pkg]) await saveManualReview(ctx, a.taskId, a.submissionId, { error: "not_configured: GRADER_URL / GRADER_SECRET not set" });
    } else {
      await gradeFiles(ctx, files);
      const packageSub = subs.find((s) => s.task_id == null);
      if (pkg.length > 0 && packageSub) await gradePackage(ctx, pkg, packageSub, testRes.data?.package_expectations);
    }

    // Completion: every task has a result -> scores (Prompt 7).
    const { data: latest } = await service.from("cc_task_results").select("task_id,status").eq("attempt_id", attemptId);
    if (readyForScoring(tasks, (latest ?? []) as { task_id: string; status: string }[])) {
      try {
        const scored = await computeAttemptScores(attemptId);
        if (!scored.ok) console.error("[cc-grader] computeAttemptScores:", scored.reason);
      } catch (e) {
        console.error("[cc-grader] computeAttemptScores failed:", e instanceof Error ? e.message : "unknown");
      }
    }

    return { ok: true, tasks: work.length };
  } catch (e) {
    console.error("[cc-grader] enqueue failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
