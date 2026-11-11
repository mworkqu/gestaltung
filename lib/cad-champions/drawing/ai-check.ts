// AI drawing check (Prompt 8 Step B) — SERVER ONLY.
//
// runAiCheck(client, input)   one model call (+ one retry on invalid output)
//                             with the PDF as a document block BEFORE the
//                             instructions, output forced through the
//                             submit_checklist tool and zod-validated. Pure apart
//                             from the injected client (tested with a mock).
// checkDrawingTask(service, …) the queue hook (grader/queue.ts): finds the PDF
//                             (per_task upload or the module_package ZIP),
//                             applies the limits (<= 5 pages, <= 20 MB), runs the
//                             check and writes cc_aspect_results,
//                             cc_task_results (ai_score, status
//                             ai_pending_review, details.ai_summary) and a
//                             cc_grading_logs row (tokens + cost). Anything that
//                             stops the AI -> the drawing goes straight to the
//                             trainer with a reason (needs_manual_review).
// Env: ANTHROPIC_API_KEY (never reaches the browser), ANTHROPIC_MODEL.

import Anthropic from "@anthropic-ai/sdk";

import { createServiceClient } from "@/lib/supabase/service";

import { normalizeEntryPath, isPackageManifest } from "../upload/package-check";
import { readZipEntries } from "../upload/zip-manifest";
import { openStoredZip } from "../upload/zip-remote";
import { readZipEntryData } from "../grader/zip-extract";
import { estimateCostUsd } from "./ai-prices";
import { scoreAiItems, summaryText, type AiAspect } from "./ai-schema";
import { runAiCheck, type MessagesClient } from "./ai-run";
import { AI_MAX_BYTES, countPdfPages, pdfLimitProblem } from "./pdf";
import { parseRubric, rubricIdFromCheckKey, type RubricItem } from "./rubric";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/drawing/ai-check.ts is server-only");

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const AI_TIMEOUT_MS = 120_000;
const SUBMISSIONS_BUCKET = "cc-submissions";

export function anthropicModel(): string {
  return (process.env.ANTHROPIC_MODEL ?? "").trim() || DEFAULT_ANTHROPIC_MODEL;
}

export function aiConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY ?? "").trim();
}

/** The SDK client (null without a key). One SDK retry for network / 5xx errors. */
export function anthropicClient(): Anthropic | null {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
}

export { runAiCheck, type AiCheckInput, type AiCheckRun, type MessagesClient } from "./ai-run";

// ─── queue hook ────────────────────────────────────────────────────────────

type Service = NonNullable<ReturnType<typeof createServiceClient>>;

export type SkipReason =
  | "ai_not_configured"
  | "no_ai_items"
  | "file_missing"
  | "no_pdf_in_package"
  | "not_pdf"
  | "too_large"
  | "too_many_pages"
  | "invalid_output"
  | "timeout"
  | "api_error"
  | "refusal"
  | "error";

export type DrawingCheckOutcome = { ok: true; aiScore: number; summary: ReturnType<typeof scoreAiItems>["summary"] } | { ok: false; reason: SkipReason };

export interface DrawingCheckTarget {
  attemptId: string;
  userId: string;
  taskId: string;
  taskResultId: string;
  submissionId: string;
}

type FileBytes = { ok: true; bytes: Uint8Array } | { ok: false; reason: SkipReason };

async function readUpload(service: Service, path: string): Promise<FileBytes> {
  const { data, error } = await service.storage.from(SUBMISSIONS_BUCKET).download(path);
  if (error || !data) return { ok: false, reason: "file_missing" };
  if (data.size > AI_MAX_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
}

/** The task's PDF inside the module_package ZIP (first .pdf the package check matched to the task). */
async function readFromPackage(path: string, manifest: unknown, taskId: string): Promise<FileBytes> {
  if (!isPackageManifest(manifest)) return { ok: false, reason: "no_pdf_in_package" };
  const files = manifest.tasks.find((t) => t.taskId === taskId)?.items.flatMap((i) => i.files) ?? [];
  const pdfName = files.find((f) => f.toLowerCase().endsWith(".pdf"));
  if (!pdfName) return { ok: false, reason: "no_pdf_in_package" };
  const zip = await openStoredZip(SUBMISSIONS_BUCKET, path, 900);
  if (!zip.ok) return { ok: false, reason: "file_missing" };
  const listing = await readZipEntries(zip.size, zip.read, { maxEntries: 500 });
  if (!listing.ok) return { ok: false, reason: "file_missing" };
  const entry = listing.entries.find((e) => {
    const safe = normalizeEntryPath(e.name);
    return safe.ok && safe.path === pdfName;
  });
  if (!entry) return { ok: false, reason: "no_pdf_in_package" };
  if (entry.uncompressedSize > AI_MAX_BYTES) return { ok: false, reason: "too_large" };
  const data = await readZipEntryData(entry, zip.read, AI_MAX_BYTES);
  if (!data.ok) return { ok: false, reason: data.reason === "too_large" ? "too_large" : "file_missing" };
  return { ok: true, bytes: data.bytes };
}

async function logRow(service: Service, t: DrawingCheckTarget, row: { model?: string | null; durationMs: number; tokensIn?: number; tokensOut?: number; error?: string | null; errorCode?: string | null; response?: unknown }) {
  const model = row.model ?? null;
  const { error } = await service.from("cc_grading_logs").insert({
    kind: "ai_drawing",
    submission_id: t.submissionId,
    task_result_id: t.taskResultId,
    model,
    duration_ms: Math.max(0, Math.round(row.durationMs)),
    tokens_in: row.tokensIn ?? null,
    tokens_out: row.tokensOut ?? null,
    cost_estimate: model && (row.tokensIn || row.tokensOut) ? estimateCostUsd(model, row.tokensIn ?? 0, row.tokensOut ?? 0) : null,
    error: row.error ? row.error.slice(0, 1000) : null,
    error_code: row.errorCode ?? null,
    response: row.response ?? null,
  });
  if (error) console.error("[cc-ai-check] log insert failed:", error.code ?? error.message);
}

async function markManual(service: Service, t: DrawingCheckTarget, reason: SkipReason, log: Parameters<typeof logRow>[2]): Promise<DrawingCheckOutcome> {
  const { error } = await service
    .from("cc_task_results")
    .update({ status: "ai_pending_review", needs_manual_review: true, ai_score: null, details: { ai_skipped: reason } })
    .eq("id", t.taskResultId);
  if (error) console.error("[cc-ai-check] manual update failed:", error.code ?? error.message);
  await logRow(service, t, { ...log, errorCode: reason });
  return { ok: false, reason };
}

/** Runs the AI check for one drawing task result. Never throws. */
export async function checkDrawingTask(service: Service, t: DrawingCheckTarget, client: MessagesClient | null = anthropicClient()): Promise<DrawingCheckOutcome> {
  const started = Date.now();
  const since = () => Date.now() - started;
  try {
    if (!client) return markManual(service, t, "ai_not_configured", { durationMs: 0, error: "ANTHROPIC_API_KEY not set" });

    const [taskRes, aspectsRes, subRes] = await Promise.all([
      service.from("cc_test_tasks").select("id,brief_en,rubric,grader_mode").eq("id", t.taskId).maybeSingle<{ id: string; brief_en: string | null; rubric: unknown; grader_mode: string | null }>(),
      service.from("cc_task_aspects").select("id,check_key,method,max_points,description_en").eq("task_id", t.taskId).order("position"),
      service.from("cc_submissions").select("id,task_id,storage_path,package_manifest").eq("id", t.submissionId).maybeSingle<{ id: string; task_id: string | null; storage_path: string; package_manifest: unknown }>(),
    ]);
    if (taskRes.error || aspectsRes.error || subRes.error) throw new Error((taskRes.error ?? aspectsRes.error ?? subRes.error)!.message);

    const rubric = parseRubric(taskRes.data?.rubric);
    const rubricItems = new Map((rubric?.items ?? []).map((i) => [i.id, i]));
    const aspectRows = (aspectsRes.data ?? []) as { id: string; check_key: string | null; method: string; max_points: number | string; description_en: string }[];
    const aiAspects: AiAspect[] = [];
    const items: Pick<RubricItem, "id" | "text_en" | "required" | "ai_guidance">[] = [];
    for (const a of aspectRows) {
      if (a.method !== "ai_drawing") continue;
      const id = rubricIdFromCheckKey(a.check_key);
      if (!id) continue;
      const item = rubricItems.get(id);
      aiAspects.push({ aspectId: a.id, itemId: id, maxPoints: Number(a.max_points) || 0 });
      items.push(item ?? { id, text_en: a.description_en });
    }
    if (aiAspects.length === 0) return markManual(service, t, "no_ai_items", { durationMs: since() });

    const sub = subRes.data;
    if (!sub) return markManual(service, t, "file_missing", { durationMs: since() });
    const file = sub.task_id == null ? await readFromPackage(sub.storage_path, sub.package_manifest, t.taskId) : await readUpload(service, sub.storage_path);
    if (!file.ok) return markManual(service, t, file.reason, { durationMs: since() });
    const problem = pdfLimitProblem(file.bytes);
    if (problem) {
      return markManual(service, t, problem, { durationMs: since(), response: { bytes: file.bytes.length, pages: countPdfPages(file.bytes) } });
    }

    const model = anthropicModel();
    const run = await runAiCheck(client, {
      model,
      pdfBase64: Buffer.from(file.bytes).toString("base64"),
      items,
      brief: taskRes.data?.brief_en ?? null,
      kind: rubric?.kind ?? (taskRes.data?.grader_mode === "assembly" ? "assembly" : "part"),
    });
    if (!run.ok) {
      return markManual(service, t, run.reason, { model, durationMs: since(), tokensIn: run.tokensIn, tokensOut: run.tokensOut, error: run.error, response: { attempts: run.attempts, raw: run.raw } });
    }

    const scored = scoreAiItems(aiAspects, run.items);
    // Replace this task result's AI aspect rows (partial unique index: no ON CONFLICT).
    const ids = aiAspects.map((a) => a.aspectId);
    const del = await service.from("cc_aspect_results").delete().eq("task_result_id", t.taskResultId).in("aspect_id", ids);
    if (del.error) console.error("[cc-ai-check] aspect delete failed:", del.error.code ?? del.error.message);
    const at = new Date().toISOString();
    const ins = await service.from("cc_aspect_results").insert(
      scored.outcomes.map((o) => ({
        task_result_id: t.taskResultId,
        aspect_id: o.aspectId,
        user_id: t.userId,
        passed: o.passed,
        points_awarded: o.points,
        feedback_en: o.feedbackEn || null,
        feedback_ar: o.feedbackAr || null,
        graded_at: at,
      }))
    );
    if (ins.error) console.error("[cc-ai-check] aspect insert failed:", ins.error.code ?? ins.error.message);

    const { error: uErr } = await service
      .from("cc_task_results")
      .update({
        status: "ai_pending_review",
        ai_score: scored.aiScore,
        needs_manual_review: false,
        details: { ai_summary: { ...scored.summary, text: summaryText(scored.summary) }, ai_checked_at: at },
      })
      .eq("id", t.taskResultId);
    if (uErr) console.error("[cc-ai-check] result update failed:", uErr.code ?? uErr.message);

    await logRow(service, t, {
      model,
      durationMs: since(),
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      // Staff only: per-item status, confidence, evidence and page for the review screen.
      response: { items: run.items, attempts: run.attempts, ai_score: scored.aiScore, summary: scored.summary },
    });
    return { ok: true, aiScore: scored.aiScore, summary: scored.summary };
  } catch (e) {
    console.error("[cc-ai-check] failed:", e instanceof Error ? e.message : "unknown");
    return markManual(service, t, "error", { durationMs: since(), error: e instanceof Error ? e.message : "unknown" });
  }
}
