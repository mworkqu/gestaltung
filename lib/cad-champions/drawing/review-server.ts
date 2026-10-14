// Trainer review data — SERVER ONLY (service role). The CALLER checks that
// the viewer is staff (requireCcStaff / getCcUser().isStaff) first.
//
// loadReviewQueue  the list on /admin/review (oldest first, filters)
// loadReviewItem   one review screen: file, rubric aspects with the AI's
//                  status / confidence / evidence (from cc_grading_logs,
//                  staff only), earlier decisions, native files, next item
// packageFileList  files of a module_package ZIP a trainer may download

import type { Locale } from "@/i18n/routing";
import { createServiceClient } from "@/lib/supabase/service";

import { isPackageManifest } from "../upload/package-check";
import { ccPath } from "../routes";
import type { AiItemResult, AiSummary } from "./ai-schema";
import { rubricIdFromCheckKey } from "./rubric";
import { filterAndSortQueue, isReviewable, nextInQueue, waitingHours } from "./review";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/drawing/review-server.ts is server-only");

type Service = NonNullable<ReturnType<typeof createServiceClient>>;

const SUBMISSIONS_BUCKET = "cc-submissions";
// 10 minutes, like every other CC signed URL; the review page re-signs on load.
const SIGNED_SECONDS = 600;
const QUEUE_LIMIT = 500;

const pick = (locale: Locale, en: string | null | undefined, ar: string | null | undefined) => ((locale === "ar" ? ar : en) || en || ar || "").trim();

function isMissing(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "42703";
}

export type ReviewKind = "drawing" | "manual" | "error";

export interface QueueRow {
  id: string;
  attemptId: string;
  testId: string;
  testTitle: string;
  taskTitle: string;
  studentName: string;
  submittedAt: string | null;
  waitingHours: number | null;
  kind: ReviewKind;
  summary: AiSummary | null;
  aiSkipped: string | null;
  unclear: number;
}

export type QueueLoad = { ok: true; rows: QueueRow[]; tests: { id: string; title: string }[] } | { ok: false; reason: "unavailable" | "not_set_up" | "error" };

type ResultRow = {
  id: string;
  attempt_id: string;
  task_id: string;
  user_id: string;
  status: string;
  submission_id: string | null;
  needs_manual_review: boolean | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

function aiSummaryOf(details: Record<string, unknown> | null | undefined): AiSummary | null {
  const s = details?.ai_summary as Partial<AiSummary> | undefined;
  if (!s || typeof s !== "object" || typeof s.total !== "number") return null;
  return { pass: Number(s.pass) || 0, fail: Number(s.fail) || 0, unclear: Number(s.unclear) || 0, flagged: Number(s.flagged) || 0, total: Number(s.total) || 0 };
}

function aiSkippedOf(details: Record<string, unknown> | null | undefined): string | null {
  const r = details?.ai_skipped;
  return typeof r === "string" && r ? r : null;
}

async function queueRows(service: Service, locale: Locale): Promise<QueueLoad> {
  const { data, error } = await service
    .from("cc_task_results")
    .select("id,attempt_id,task_id,user_id,status,submission_id,needs_manual_review,details,created_at")
    .in("status", ["ai_pending_review", "pending", "error"])
    .not("submission_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(QUEUE_LIMIT);
  if (error) return { ok: false, reason: isMissing(error.code) ? "not_set_up" : "error" };
  const results = (data ?? []) as ResultRow[];
  if (results.length === 0) return { ok: true, rows: [], tests: [] };

  const taskIds = [...new Set(results.map((r) => r.task_id))];
  const attemptIds = [...new Set(results.map((r) => r.attempt_id))];
  const userIds = [...new Set(results.map((r) => r.user_id))];
  const [tasksRes, attemptsRes, profilesRes] = await Promise.all([
    service.from("cc_test_tasks").select("id,test_id,title_en,title_ar,grading_mode").in("id", taskIds),
    service.from("cc_attempts").select("id,submitted_at,status").in("id", attemptIds),
    service.from("cc_profiles").select("id,full_name,full_name_ar,email").in("id", userIds),
  ]);
  const tasks = new Map(((tasksRes.data ?? []) as { id: string; test_id: string; title_en: string; title_ar: string; grading_mode: string }[]).map((t) => [t.id, t]));
  const attempts = new Map(((attemptsRes.data ?? []) as { id: string; submitted_at: string | null; status: string }[]).map((a) => [a.id, a]));
  const profiles = new Map(((profilesRes.data ?? []) as { id: string; full_name: string | null; full_name_ar: string | null; email: string | null }[]).map((p) => [p.id, p]));
  const testIds = [...new Set([...tasks.values()].map((t) => t.test_id))];
  const { data: testRows } = testIds.length ? await service.from("cc_tests").select("id,title_en,title_ar").in("id", testIds) : { data: [] };
  const tests = new Map(((testRows ?? []) as { id: string; title_en: string; title_ar: string }[]).map((t) => [t.id, pick(locale, t.title_en, t.title_ar)]));

  const now = Date.now();
  const rows: QueueRow[] = [];
  for (const r of results) {
    const t = tasks.get(r.task_id);
    const a = attempts.get(r.attempt_id);
    if (!t || !a || a.status === "in_progress") continue;
    if (!isReviewable(r, t.grading_mode)) continue;
    const p = profiles.get(r.user_id);
    const submittedAt = a.submitted_at ?? r.created_at;
    const summary = aiSummaryOf(r.details);
    const skipped = aiSkippedOf(r.details);
    rows.push({
      id: r.id,
      attemptId: r.attempt_id,
      testId: t.test_id,
      testTitle: tests.get(t.test_id) ?? "",
      taskTitle: pick(locale, t.title_en, t.title_ar),
      studentName: (p ? pick(locale, p.full_name, p.full_name_ar) : "") || p?.email || "",
      submittedAt,
      waitingHours: waitingHours(submittedAt, now),
      kind: r.status === "error" ? "error" : t.grading_mode === "ai_drawing" ? "drawing" : "manual",
      summary,
      aiSkipped: t.grading_mode === "ai_drawing" ? (skipped ?? (summary ? null : "pending")) : null,
      unclear: summary ? summary.flagged : 0,
    });
  }
  return { ok: true, rows, tests: [...new Set(rows.map((r) => r.testId))].map((id) => ({ id, title: tests.get(id) ?? "" })) };
}

export async function loadReviewQueue(locale: Locale, filters: { testId?: string | null; unclearOnly?: boolean } = {}): Promise<QueueLoad> {
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  try {
    const all = await queueRows(service, locale);
    if (!all.ok) return all;
    return { ok: true, rows: filterAndSortQueue(all.rows, filters), tests: all.tests };
  } catch (e) {
    console.error("[cc-review] queue load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

// ─── one review ────────────────────────────────────────────────────────────

export interface ReviewAspectView {
  id: string;
  type: "measurement" | "judgement";
  method: string;
  maxPoints: number;
  description: string;
  hint: string | null;
  ai: Pick<AiItemResult, "status" | "confidence" | "evidence" | "page" | "feedback_en" | "feedback_ar"> | null;
  existing: { passed: boolean | null; score: number | null } | null;
}

export interface ReviewFile {
  name: string;
  url: string;
}

export interface ReviewItemView {
  id: string;
  status: string;
  finalized: boolean;
  attemptId: string;
  studentName: string;
  testTitle: string;
  taskTitle: string;
  taskBrief: string;
  gradingMode: string;
  submittedAt: string | null;
  waitingHours: number | null;
  aspects: ReviewAspectView[];
  summary: AiSummary | null;
  aiSkipped: string | null;
  aiModel: string | null;
  comment: { en: string; ar: string; machine: "en" | "ar" | null };
  /** The drawing to show in the viewer (PDF), null when there is none. */
  pdfUrl: string | null;
  /** The uploaded file itself (per-task file or the package ZIP). */
  upload: ReviewFile | null;
  /** Files inside a module_package ZIP for this task (+ files matched to no task). */
  packageFiles: ReviewFile[];
  unmatchedFiles: ReviewFile[];
  nextId: string | null;
  total: number;
  position: number;
}

export type ItemLoad = { ok: true; view: ReviewItemView } | { ok: false; reason: "not_found" | "unavailable" | "not_set_up" | "error" };

/** Paths a trainer may download from the package for this task: task files + unmatched files. */
export function packageFileList(manifest: unknown, taskId: string): { task: string[]; unmatched: string[] } {
  if (!isPackageManifest(manifest)) return { task: [], unmatched: [] };
  const task = [...new Set(manifest.tasks.find((t) => t.taskId === taskId)?.items.flatMap((i) => i.files) ?? [])];
  return { task, unmatched: manifest.unmatched.filter((f) => !task.includes(f)) };
}

export function packageFileUrl(locale: Locale, taskResultId: string, path: string, inline = false): string {
  return `${ccPath(locale, `/admin/review/${taskResultId}/file`)}?path=${encodeURIComponent(path)}${inline ? "&inline=1" : ""}`;
}

const baseName = (p: string) => p.split("/").pop() || p;

export async function loadReviewItem(taskResultId: string, locale: Locale): Promise<ItemLoad> {
  if (!/^[0-9a-f-]{36}$/i.test(taskResultId ?? "")) return { ok: false, reason: "not_found" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  try {
    const { data: r, error } = await service
      .from("cc_task_results")
      .select("id,attempt_id,task_id,user_id,status,submission_id,needs_manual_review,details,created_at,reviewer_comment_en,reviewer_comment_ar")
      .eq("id", taskResultId)
      .maybeSingle<ResultRow & { reviewer_comment_en: string | null; reviewer_comment_ar: string | null }>();
    if (error) return { ok: false, reason: isMissing(error.code) ? "not_set_up" : "error" };
    if (!r) return { ok: false, reason: "not_found" };

    const [taskRes, attemptRes, profileRes, aspectsRes, arRes, logRes, subRes] = await Promise.all([
      service.from("cc_test_tasks").select("id,test_id,title_en,title_ar,brief_en,brief_ar,grading_mode").eq("id", r.task_id).maybeSingle<{
        id: string;
        test_id: string;
        title_en: string;
        title_ar: string;
        brief_en: string | null;
        brief_ar: string | null;
        grading_mode: string;
      }>(),
      service.from("cc_attempts").select("id,submitted_at").eq("id", r.attempt_id).maybeSingle<{ id: string; submitted_at: string | null }>(),
      service.from("cc_profiles").select("full_name,full_name_ar,email").eq("id", r.user_id).maybeSingle<{ full_name: string | null; full_name_ar: string | null; email: string | null }>(),
      service
        .from("cc_task_aspects")
        .select("id,position,type,method,max_points,check_key,description_en,description_ar,student_hint_en,student_hint_ar")
        .eq("task_id", r.task_id)
        .order("position"),
      service.from("cc_aspect_results").select("aspect_id,passed,judgement_score").eq("task_result_id", r.id),
      service.from("cc_grading_logs").select("model,response,created_at").eq("task_result_id", r.id).eq("kind", "ai_drawing").order("created_at", { ascending: false }).limit(1),
      r.submission_id
        ? service.from("cc_submissions").select("id,task_id,storage_path,file_name,package_manifest").eq("id", r.submission_id).maybeSingle<{
            id: string;
            task_id: string | null;
            storage_path: string;
            file_name: string;
            package_manifest: unknown;
          }>()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const task = taskRes.data;
    if (!task) return { ok: false, reason: "not_found" };
    const { data: test } = await service.from("cc_tests").select("title_en,title_ar").eq("id", task.test_id).maybeSingle<{ title_en: string; title_ar: string }>();

    const log = ((logRes.data ?? []) as { model: string | null; response: unknown }[])[0];
    const aiItems = new Map<string, AiItemResult>();
    const resp = log?.response as { items?: AiItemResult[] } | null | undefined;
    for (const it of Array.isArray(resp?.items) ? resp!.items! : []) if (it && typeof it.id === "string") aiItems.set(it.id, it);
    const existing = new Map(((arRes.data ?? []) as { aspect_id: string; passed: boolean | null; judgement_score: number | null }[]).map((x) => [x.aspect_id, x]));

    const aspects: ReviewAspectView[] = ((aspectsRes.data ?? []) as {
      id: string;
      type: string;
      method: string;
      max_points: number | string;
      check_key: string | null;
      description_en: string;
      description_ar: string;
      student_hint_en: string | null;
      student_hint_ar: string | null;
    }[]).map((a) => {
      const rid = rubricIdFromCheckKey(a.check_key);
      const ai = a.method === "ai_drawing" && rid ? (aiItems.get(rid) ?? null) : null;
      const ex = existing.get(a.id);
      return {
        id: a.id,
        type: a.type === "judgement" ? "judgement" : "measurement",
        method: a.method,
        maxPoints: Number(a.max_points) || 0,
        description: pick(locale, a.description_en, a.description_ar),
        hint: pick(locale, a.student_hint_en, a.student_hint_ar) || null,
        ai: ai ? { status: ai.status, confidence: ai.confidence, evidence: ai.evidence, page: ai.page, feedback_en: ai.feedback_en, feedback_ar: ai.feedback_ar } : null,
        existing: ex ? { passed: ex.passed, score: ex.judgement_score } : null,
      };
    });

    // Files
    const sub = subRes.data;
    let pdfUrl: string | null = null;
    let upload: ReviewFile | null = null;
    let packageFiles: ReviewFile[] = [];
    let unmatchedFiles: ReviewFile[] = [];
    if (sub) {
      const dl = await service.storage.from(SUBMISSIONS_BUCKET).createSignedUrl(sub.storage_path, SIGNED_SECONDS, { download: sub.file_name });
      if (dl.data?.signedUrl) upload = { name: sub.file_name, url: dl.data.signedUrl };
      if (sub.task_id != null) {
        if (sub.file_name.toLowerCase().endsWith(".pdf")) {
          const view = await service.storage.from(SUBMISSIONS_BUCKET).createSignedUrl(sub.storage_path, SIGNED_SECONDS);
          pdfUrl = view.data?.signedUrl ?? null;
        }
      } else {
        const list = packageFileList(sub.package_manifest, r.task_id);
        packageFiles = list.task.map((p) => ({ name: p, url: packageFileUrl(locale, r.id, p) }));
        unmatchedFiles = list.unmatched.map((p) => ({ name: p, url: packageFileUrl(locale, r.id, p) }));
        const pdf = list.task.find((p) => p.toLowerCase().endsWith(".pdf"));
        if (pdf) pdfUrl = packageFileUrl(locale, r.id, pdf, true);
      }
    }

    // Queue position / next submission
    const queue = await queueRows(service, locale);
    const ids = queue.ok ? filterAndSortQueue(queue.rows, {}).map((q) => q.id) : [];
    const p = profileRes.data;
    const submittedAt = attemptRes.data?.submitted_at ?? r.created_at;
    const details = (r.details ?? {}) as Record<string, unknown>;
    const machine = details.comment_machine_translated === "en" || details.comment_machine_translated === "ar" ? (details.comment_machine_translated as "en" | "ar") : null;

    return {
      ok: true,
      view: {
        id: r.id,
        status: r.status,
        finalized: r.status === "final",
        attemptId: r.attempt_id,
        studentName: (p ? pick(locale, p.full_name, p.full_name_ar) : "") || p?.email || "",
        testTitle: test ? pick(locale, test.title_en, test.title_ar) : "",
        taskTitle: pick(locale, task.title_en, task.title_ar),
        taskBrief: pick(locale, task.brief_en, task.brief_ar),
        gradingMode: task.grading_mode,
        submittedAt,
        waitingHours: waitingHours(submittedAt),
        aspects,
        summary: aiSummaryOf(r.details),
        aiSkipped: aiSkippedOf(r.details),
        aiModel: log?.model ?? null,
        comment: { en: r.reviewer_comment_en ?? "", ar: r.reviewer_comment_ar ?? "", machine },
        pdfUrl,
        upload,
        packageFiles,
        unmatchedFiles,
        nextId: nextInQueue(ids, r.id),
        total: ids.length,
        position: ids.indexOf(r.id) + 1,
      },
    };
  } catch (e) {
    console.error("[cc-review] item load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Upload + manifest of a task result's package (for the file route). */
export async function loadPackageForResult(service: Service, taskResultId: string): Promise<{ storagePath: string; manifest: unknown; taskId: string } | null> {
  const { data: r } = await service.from("cc_task_results").select("id,task_id,submission_id").eq("id", taskResultId).maybeSingle<{ id: string; task_id: string; submission_id: string | null }>();
  if (!r?.submission_id) return null;
  const { data: sub } = await service.from("cc_submissions").select("task_id,storage_path,package_manifest").eq("id", r.submission_id).maybeSingle<{ task_id: string | null; storage_path: string; package_manifest: unknown }>();
  if (!sub || sub.task_id != null) return null;
  return { storagePath: sub.storage_path, manifest: sub.package_manifest, taskId: r.task_id };
}

export { baseName };
