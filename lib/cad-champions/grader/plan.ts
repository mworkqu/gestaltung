// Grading queue decisions. Pure (no I/O); tested in plan.test.ts.
//
// - planGrading: what enqueueGrading does with each task of an attempt
// - readyForScoring: when computeAttemptScores may run
// - mapLimit: run async work with a concurrency cap
// - selectPackageSteps: which STEP files of a module_package ZIP go to the grader

import { extOf, isJunkEntry, normalizeEntryPath, type ZipEntryInfo } from "../upload/package-check";
import { DEFAULT_MAX_BYTES } from "../upload/validate";

/** Statuses that mean "already graded": a second enqueue leaves them alone. */
export const SETTLED_STATUSES = ["auto", "final", "ai_pending_review"] as const;

export const GRADER_CONCURRENCY = 4;
export const MAX_PACKAGE_STEP_FILES = 40;

export interface PlanTask {
  id: string;
  grading_mode: string;
}

export interface PlanSubmission {
  id: string;
  task_id: string | null;
}

export interface PlanResult {
  task_id: string;
  status: string;
}

export type TaskAction =
  /** Already graded (or a manual task already waiting): nothing to do. */
  | { kind: "skip"; taskId: string }
  /** per_task STEP file -> /grade. */
  | { kind: "grade_file"; taskId: string; submissionId: string }
  /** module_package: graded together through /grade-package. */
  | { kind: "grade_package"; taskId: string; submissionId: string }
  /** Nothing uploaded for an auto/AI task: 0 points. */
  | { kind: "no_file"; taskId: string }
  /** Drawing: placeholder for the AI check (Prompt 8). */
  | { kind: "ai_placeholder"; taskId: string; submissionId: string }
  /** Trainer task: pending until a trainer scores it. */
  | { kind: "manual_pending"; taskId: string; submissionId: string | null };

export function planGrading(input: {
  uploadMode: string;
  tasks: readonly PlanTask[];
  submissions: readonly PlanSubmission[];
  results: readonly PlanResult[];
}): TaskAction[] {
  const pkg = input.uploadMode === "module_package";
  const packageSub = input.submissions.find((s) => s.task_id == null) ?? null;
  const status = new Map(input.results.map((r) => [r.task_id, r.status]));
  const settled = new Set<string>(SETTLED_STATUSES);

  return input.tasks.map((t): TaskAction => {
    const current = status.get(t.id);
    if (current && settled.has(current)) return { kind: "skip", taskId: t.id };
    const sub = pkg ? packageSub : (input.submissions.find((s) => s.task_id === t.id) ?? null);

    if (t.grading_mode === "manual") {
      if (current) return { kind: "skip", taskId: t.id };
      return { kind: "manual_pending", taskId: t.id, submissionId: sub?.id ?? null };
    }
    if (!sub) return { kind: "no_file", taskId: t.id };
    if (t.grading_mode === "ai_drawing") return { kind: "ai_placeholder", taskId: t.id, submissionId: sub.id };
    return pkg ? { kind: "grade_package", taskId: t.id, submissionId: sub.id } : { kind: "grade_file", taskId: t.id, submissionId: sub.id };
  });
}

/**
 * Scores may be computed once every task has a result row and no auto or AI
 * task is still waiting to be checked. Manual tasks may stay pending (the
 * attempt is then provisional).
 */
export function readyForScoring(tasks: readonly PlanTask[], results: readonly PlanResult[]): boolean {
  if (tasks.length === 0) return false;
  const status = new Map(results.map((r) => [r.task_id, r.status]));
  return tasks.every((t) => {
    const s = status.get(t.id);
    if (!s) return false;
    return s !== "pending" || t.grading_mode === "manual";
  });
}

/** Runs fn over items with at most `limit` running at once; results keep the input order. Never rejects. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const cap = Math.max(1, Math.min(limit, items.length || 1));
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (e) {
        out[i] = { status: "rejected", reason: e };
      }
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return out;
}

export interface PackageStep {
  /** Normalised path inside the ZIP (what the grader's name patterns match). */
  name: string;
  entry: ZipEntryInfo;
}

/**
 * STEP files of a package that can be sent to the grader: safe path, not OS
 * junk, .step/.stp, not encrypted, at most 50 MB uncompressed. Files in
 * "Parts and Assemblies" come first; at most `max` files.
 */
export function selectPackageSteps(entries: readonly ZipEntryInfo[], max: number = MAX_PACKAGE_STEP_FILES): PackageStep[] {
  const out: (PackageStep & { inParts: boolean })[] = [];
  for (const e of entries) {
    if (e.isDirectory || e.encrypted) continue;
    const safe = normalizeEntryPath(e.name);
    if (!safe.ok || isJunkEntry(safe.segments)) continue;
    const ext = extOf(safe.path);
    if (ext !== ".step" && ext !== ".stp") continue;
    if (!(e.uncompressedSize > 0) || e.uncompressedSize > DEFAULT_MAX_BYTES) continue;
    const inParts = safe.segments.some((s) => s.trim().toLowerCase() === "parts and assemblies");
    out.push({ name: safe.path, entry: e, inParts });
  }
  out.sort((a, b) => Number(b.inParts) - Number(a.inParts));
  return out.slice(0, max).map(({ name, entry }) => ({ name, entry }));
}
