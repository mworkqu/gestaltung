"use server";

// Test flow server actions (Prompt 5). Every action checks the CC session
// itself, then writes with the service role (students can only READ attempts
// and submissions under RLS, so timers, files and integrity flags cannot be
// forged from the browser).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { getCcUser } from "../auth/server";
import { ccRateLimited } from "../rate-limits";
import type { CcAttachment, CcExpectedUpload } from "../db/types";
import { checkPackage, failedManifest, PACKAGE_MAX_BYTES, parseExpectations, type PackageManifest } from "../upload/package-check";
import { enforceStorageQuota } from "../upload/quota-server";
import { verifyUploadedObject } from "../upload/server";
import { DEFAULT_MAX_BYTES, cleanDisplayFileName, isPathUnderPrefix, type UploadAccept } from "../upload/validate";
import { readStoredZip } from "../upload/zip-remote";
import {
  SUBMISSIONS_BUCKET,
  TASK_FILES_BUCKET,
  closeIfExpired,
  finalizeAttempt,
  loadAttempts,
  loadOwnAttempt,
  loadTest,
  readGate,
  requestMeta,
  type AttemptRow,
} from "./server";
import { acceptsWork, introState, submitReasonFor } from "./status";
import { PART_COLLECTED_KEY, TOO_FAST_SECONDS, deadlineFrom, parseTime, partCollectedDueAt } from "./timer";

type TestMeta = { id: string; type: string; upload_mode: string; grace_seconds: number; package_expectations: unknown };

async function testMeta(testId: string): Promise<TestMeta | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data } = await service
    .from("cc_tests")
    .select("id,type,upload_mode,grace_seconds,package_expectations")
    .eq("id", testId)
    .maybeSingle<TestMeta>();
  return data ?? null;
}

// ------------------------------------------------------------------ start

export type StartResult =
  | { ok: true; attemptId: string }
  | { ok: false; reason: "signed_out" | "no_profile" | "not_found" | "locked" | "cooldown" | "not_set_up" | "unavailable" | "error" };

/** Starts the test (or returns the running attempt). The deadline is set here, on the server. */
export async function startAttemptAction(slug: string): Promise<StartResult> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  if (!cc.profile) return { ok: false, reason: "no_profile" };
  if (ccRateLimited("action", cc.user.id)) return { ok: false, reason: "unavailable" };

  const loaded = await loadTest(String(slug ?? ""));
  if (!loaded.ok) return { ok: false, reason: loaded.reason === "not_set_up" ? "not_set_up" : loaded.reason === "not_found" ? "not_found" : "error" };
  const { test, tasks } = loaded;
  if ((!test.is_published && !cc.isStaff) || tasks.length === 0) return { ok: false, reason: "not_found" };

  const attempts = await Promise.all((await loadAttempts(cc.user.id, test.id)).map((a) => closeIfExpired(a, test)));
  const gate = await readGate(cc);
  const now = Date.now();
  const state = introState({
    attempts,
    testType: test.type,
    cooldownDays: test.retake_cooldown_days,
    graceSeconds: test.grace_seconds,
    gate,
    isStaff: cc.isStaff,
    now,
  });
  if (state.kind === "continue") return { ok: true, attemptId: state.attemptId };
  if (state.kind === "cooldown") return { ok: false, reason: "cooldown" };
  if (state.kind === "locked") return { ok: false, reason: "locked" };

  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  const meta = await requestMeta();
  const deadline = deadlineFrom(now, test.time_limit_minutes);
  const { data, error } = await service
    .from("cc_attempts")
    .insert({
      user_id: cc.user.id,
      test_id: test.id,
      started_at: new Date(now).toISOString(),
      deadline_at: deadline == null ? null : new Date(deadline).toISOString(),
      status: "in_progress",
      start_ip: meta.ip,
      start_user_agent: meta.userAgent,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    // 23505: another tab started it a moment ago (one active attempt per test).
    if (error.code === "23505") {
      const running = (await loadAttempts(cc.user.id, test.id)).find((a) => a.status === "in_progress");
      if (running) return { ok: true, attemptId: running.id };
    }
    console.error("[cc-test] start failed:", error.code ?? error.message);
    return { ok: false, reason: "error" };
  }
  if (!data) return { ok: false, reason: "error" };
  return { ok: true, attemptId: data.id };
}

// ------------------------------------------------------------------ uploads

export type RecordResult =
  | { ok: true; uploadedAt: string; replacedCount: number }
  | { ok: false; reason: "signed_out" | "not_allowed" | "closed" | "invalid_file" | "over_quota" | "unavailable" | "error" };

const ACCEPT_FOR: Record<CcExpectedUpload, UploadAccept | null> = {
  step: "step",
  pdf: "pdf",
  image: "image",
  video: "video",
  none: null,
};

async function flagOnce(
  service: NonNullable<ReturnType<typeof createServiceClient>>,
  row: { attempt_id: string; task_id: string | null; user_id: string; kind: "duplicate_sha256" | "too_fast"; details: Record<string, unknown> }
) {
  let q = service.from("cc_integrity_flags").select("id").eq("attempt_id", row.attempt_id).eq("kind", row.kind).limit(1);
  q = row.task_id ? q.eq("task_id", row.task_id) : q.is("task_id", null);
  const { data } = await q;
  if (data && data.length > 0) return;
  const { error } = await service.from("cc_integrity_flags").insert(row);
  if (error) console.error("[cc-test] integrity flag failed:", error.code ?? error.message);
}

/**
 * Saves an uploaded file as the submission for one task (taskId) or as the
 * attempt's package ZIP (taskId null). Re-checks the stored object, replaces
 * an earlier file (replaced_count + 1) and raises quiet integrity flags.
 */
export async function recordSubmissionAction(input: {
  attemptId: string;
  taskId: string | null;
  path: string;
  fileName: string;
  size: number;
  sha256: string;
}): Promise<RecordResult> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  const userId = cc.user.id;
  if (ccRateLimited("upload", userId)) return { ok: false, reason: "unavailable" };
  const attempt = await loadOwnAttempt(String(input?.attemptId ?? ""), userId);
  if (!attempt) return { ok: false, reason: "not_allowed" };
  const test = await testMeta(attempt.test_id);
  const service = createServiceClient();
  if (!test || !service) return { ok: false, reason: "unavailable" };

  const now = Date.now();
  if (!acceptsWork(attempt, now, test.grace_seconds)) {
    await closeIfExpired(attempt, test, now);
    return { ok: false, reason: "closed" };
  }

  const taskId = input.taskId ?? null;
  let accept: UploadAccept | null;
  let maxBytes: number;
  if (taskId == null) {
    if (test.upload_mode !== "module_package") return { ok: false, reason: "not_allowed" };
    accept = "zip";
    maxBytes = PACKAGE_MAX_BYTES;
  } else {
    if (test.upload_mode !== "per_task" || !/^[0-9a-f-]{36}$/i.test(taskId)) return { ok: false, reason: "not_allowed" };
    const { data: task } = await service
      .from("cc_test_tasks")
      .select("id,expected_upload")
      .eq("id", taskId)
      .eq("test_id", attempt.test_id)
      .maybeSingle<{ id: string; expected_upload: CcExpectedUpload }>();
    if (!task) return { ok: false, reason: "not_allowed" };
    accept = ACCEPT_FOR[task.expected_upload];
    maxBytes = DEFAULT_MAX_BYTES;
  }
  if (!accept) return { ok: false, reason: "not_allowed" };

  const prefix = `${userId}/${attempt.id}/${taskId ?? "package"}/`;
  if (!isPathUnderPrefix(input.path, prefix)) return { ok: false, reason: "not_allowed" };

  const verified = await verifyUploadedObject(SUBMISSIONS_BUCKET, input.path, accept, maxBytes);
  if (!verified.ok) {
    if (verified.code === "unavailable") return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "invalid_file" };
  }
  const quota = await enforceStorageQuota(userId, SUBMISSIONS_BUCKET, input.path);
  if (!quota.ok) return { ok: false, reason: "over_quota" };

  const sha256 = typeof input.sha256 === "string" && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
  const fileName = cleanDisplayFileName(input.fileName, 255);
  // SR-L10: the stored object's real size, not the number the browser sent.
  const size = verified.size;
  const uploadedAt = new Date(now).toISOString();
  const row = {
    storage_path: input.path,
    file_name: fileName,
    file_size: size,
    mime_type: accept === "zip" ? "application/zip" : null,
    sha256,
    uploaded_at: uploadedAt,
    package_manifest: null,
  };

  const findExisting = async () => {
    let q = service.from("cc_submissions").select("id,replaced_count").eq("attempt_id", attempt.id);
    q = taskId ? q.eq("task_id", taskId) : q.is("task_id", null);
    const { data } = await q.maybeSingle<{ id: string; replaced_count: number }>();
    return data ?? null;
  };

  let replacedCount = 0;
  let existing = await findExisting();
  if (!existing) {
    const { error } = await service
      .from("cc_submissions")
      .insert({ ...row, attempt_id: attempt.id, task_id: taskId, user_id: userId, replaced_count: 0 });
    if (error) {
      if (error.code !== "23505") {
        console.error("[cc-test] submission insert failed:", error.code ?? error.message);
        return { ok: false, reason: "error" };
      }
      existing = await findExisting(); // another request inserted it first: replace it
    }
  }
  if (existing) {
    replacedCount = (existing.replaced_count ?? 0) + 1;
    const { error } = await service.from("cc_submissions").update({ ...row, replaced_count: replacedCount }).eq("id", existing.id);
    if (error) {
      console.error("[cc-test] submission update failed:", error.code ?? error.message);
      return { ok: false, reason: "error" };
    }
  }

  // Quiet integrity checks (admin-only; never shown to students).
  try {
    if (sha256) {
      let q = service.from("cc_submissions").select("user_id,attempt_id").eq("sha256", sha256).neq("user_id", userId).limit(1);
      q = taskId ? q.eq("task_id", taskId) : q.is("task_id", null);
      const { data: dup } = await q;
      const other = (dup ?? [])[0] as { user_id: string; attempt_id: string } | undefined;
      if (other) {
        await flagOnce(service, {
          attempt_id: attempt.id,
          task_id: taskId,
          user_id: userId,
          kind: "duplicate_sha256",
          details: { sha256, other_user_id: other.user_id, other_attempt_id: other.attempt_id, in_person: attempt.in_person },
        });
      }
    }
    const started = parseTime(attempt.started_at);
    if (started != null && now - started < TOO_FAST_SECONDS * 1000) {
      await flagOnce(service, {
        attempt_id: attempt.id,
        task_id: taskId,
        user_id: userId,
        kind: "too_fast",
        details: { seconds_after_start: Math.round((now - started) / 1000), in_person: attempt.in_person },
      });
    }
  } catch (e) {
    console.error("[cc-test] integrity check failed:", e instanceof Error ? e.message : "unknown");
  }

  return { ok: true, uploadedAt, replacedCount };
}

export type PackageResult =
  | { ok: true; manifest: PackageManifest }
  | { ok: false; reason: "signed_out" | "not_allowed" | "missing" | "unavailable" | "error" };

/**
 * Lists the attempt's package ZIP (central directory only, ranged reads),
 * compares it with the test's expectations and stores the manifest.
 */
export async function validatePackageAction(attemptId: string): Promise<PackageResult> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  if (ccRateLimited("upload", cc.user.id)) return { ok: false, reason: "unavailable" };
  const attempt = await loadOwnAttempt(String(attemptId ?? ""), cc.user.id);
  if (!attempt) return { ok: false, reason: "not_allowed" };
  const test = await testMeta(attempt.test_id);
  const service = createServiceClient();
  if (!test || !service) return { ok: false, reason: "unavailable" };
  if (test.upload_mode !== "module_package") return { ok: false, reason: "not_allowed" };

  const { data: sub } = await service
    .from("cc_submissions")
    .select("id,storage_path")
    .eq("attempt_id", attempt.id)
    .is("task_id", null)
    .maybeSingle<{ id: string; storage_path: string }>();
  if (!sub) return { ok: false, reason: "missing" };

  const expectations = parseExpectations(test.package_expectations);
  const listing = await readStoredZip(SUBMISSIONS_BUCKET, sub.storage_path);
  let manifest: PackageManifest;
  if (listing.ok) {
    manifest = checkPackage(listing.entries, expectations);
  } else if (listing.reason === "missing" || listing.reason === "unavailable") {
    return { ok: false, reason: listing.reason };
  } else {
    manifest = failedManifest(listing.reason, expectations, "totalEntries" in listing ? (listing.totalEntries ?? 0) : 0);
  }

  const { error } = await service.from("cc_submissions").update({ package_manifest: manifest }).eq("id", sub.id);
  if (error) {
    console.error("[cc-test] manifest save failed:", error.code ?? error.message);
    return { ok: false, reason: "error" };
  }
  return { ok: true, manifest };
}

// ------------------------------------------------------------------ downloads

export type DownloadResult = { ok: true; url: string } | { ok: false; reason: "signed_out" | "not_allowed" | "missing" | "unavailable" };

/** SR-M4 switch: task files only after the timed attempt has started (default off = current behaviour). */
function taskFilesAfterStart(): boolean {
  return process.env.CC_TASK_FILES_AFTER_START === "1";
}

/** A 10-minute signed URL for one of a task's files (open in the browser or download). */
export async function createSignedDownload(taskId: string, path: string, mode: "open" | "download"): Promise<DownloadResult> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  if (!/^[0-9a-f-]{36}$/i.test(String(taskId ?? "")) || typeof path !== "string") return { ok: false, reason: "not_allowed" };
  if (ccRateLimited("action", cc.user.id)) return { ok: false, reason: "unavailable" };

  // The public view enforces visibility (published tests, or staff).
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("cc_test_tasks_public")
    .select("id,test_id,attachments")
    .eq("id", taskId)
    .maybeSingle<{ id: string; test_id: string; attachments: CcAttachment[] | null }>();
  const files = Array.isArray(task?.attachments) ? task.attachments : [];
  if (!task || !files.some((a) => a && a.path === path)) return { ok: false, reason: "not_allowed" };

  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };

  // SR-M4 (owner decision, OFF by default): with CC_TASK_FILES_AFTER_START=1 a
  // student gets task files only while their own attempt on that test is running.
  if (taskFilesAfterStart() && !cc.isStaff) {
    const { data: running } = await service
      .from("cc_attempts")
      .select("id")
      .eq("user_id", cc.user.id)
      .eq("test_id", task.test_id)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();
    if (!running) return { ok: false, reason: "not_allowed" };
  }
  const name = path.split("/").pop() || "file";
  const { data, error } = await service.storage
    .from(TASK_FILES_BUCKET)
    .createSignedUrl(path, 600, mode === "download" ? { download: name } : undefined);
  if (error || !data?.signedUrl) return { ok: false, reason: /not.?found|404/i.test(error?.message ?? "") ? "missing" : "unavailable" };
  return { ok: true, url: data.signedUrl };
}

// ------------------------------------------------------------------ submit

export type SubmitResult = { ok: true } | { ok: false; reason: "signed_out" | "not_allowed" | "unavailable" | "error" };

/** Hands the test in (manual, or "timeout" when called after the deadline). */
export async function submitAttemptAction(attemptId: string): Promise<SubmitResult> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  const attempt = await loadOwnAttempt(String(attemptId ?? ""), cc.user.id);
  if (!attempt) return { ok: false, reason: "not_allowed" };
  if (attempt.status !== "in_progress") return { ok: true };
  const test = await testMeta(attempt.test_id);
  if (!test) return { ok: false, reason: "unavailable" };

  const reason = submitReasonFor(Date.now(), attempt.deadline_at);
  const closed = await finalizeAttempt(attempt, reason, await requestMeta(), test.type);
  if (closed) return { ok: true };
  // Not closed by this call: closed meanwhile (fine) or a write error.
  const again = await loadOwnAttempt(attempt.id, cc.user.id);
  return again && again.status !== "in_progress" ? { ok: true } : { ok: false, reason: "error" };
}

// ------------------------------------------------------------------ phase markers

export type PhaseResult =
  | { ok: true; at: string }
  | { ok: false; reason: "signed_out" | "not_allowed" | "too_early" | "unavailable" | "error" };

/**
 * Records the M4 "physical part collected" marker on an in-person attempt.
 * The student's page calls it when the clock reaches 2:00; staff may record
 * it at any time. Idempotent: the first time wins.
 */
export async function recordPhaseMarkerAction(attemptId: string, key: string): Promise<PhaseResult> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  if (key !== PART_COLLECTED_KEY) return { ok: false, reason: "not_allowed" };
  if (!/^[0-9a-f-]{36}$/i.test(String(attemptId ?? ""))) return { ok: false, reason: "not_allowed" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };

  const { data: attempt } = await service
    .from("cc_attempts")
    .select("id,user_id,test_id,status,started_at,in_person,phase_markers")
    .eq("id", String(attemptId ?? ""))
    .maybeSingle<Pick<AttemptRow, "id" | "user_id" | "test_id" | "status" | "started_at" | "in_person" | "phase_markers">>();
  if (!attempt || (attempt.user_id !== cc.user.id && !cc.isStaff)) return { ok: false, reason: "not_allowed" };
  if (!attempt.in_person) return { ok: false, reason: "not_allowed" };

  const markers = Array.isArray(attempt.phase_markers) ? attempt.phase_markers : [];
  const existing = markers.find((m) => m && m.key === key);
  if (existing) return { ok: true, at: existing.at };

  const { data: m4 } = await service.from("cc_test_tasks").select("id").eq("test_id", attempt.test_id).eq("competition_module", "M4").limit(1);
  if (!m4 || m4.length === 0) return { ok: false, reason: "not_allowed" };

  const now = Date.now();
  const due = partCollectedDueAt(parseTime(attempt.started_at));
  if (!cc.isStaff && (attempt.status !== "in_progress" || due == null || now < due - 5000)) return { ok: false, reason: "too_early" };

  const at = new Date(now).toISOString();
  const { error } = await service
    .from("cc_attempts")
    .update({ phase_markers: [...markers, { key, at, by: cc.user.id }] })
    .eq("id", attempt.id);
  if (error) {
    console.error("[cc-test] phase marker failed:", error.code ?? error.message);
    return { ok: false, reason: "error" };
  }
  if (cc.isStaff && attempt.user_id !== cc.user.id) {
    await service.from("cc_audit_log").insert({
      actor_id: cc.user.id,
      action: "attempt.phase_marker",
      entity_type: "cc_attempts",
      entity_id: attempt.id,
      after: { key, at },
    });
  }
  return { ok: true, at };
}
