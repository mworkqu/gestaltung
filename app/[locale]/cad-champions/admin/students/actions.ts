"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { startInPersonAttempts, type InPersonStartResult } from "@/lib/cad-champions/admin/in-person";
import { adminGuard, isMissingSchema, writeAudit, type ActionResult } from "@/lib/cad-champions/admin/server";
import { parseBool, STUDENT_AUDIT_ACTIONS, verificationState } from "@/lib/cad-champions/admin/student-actions";
import { cleanNote, isUuid, parseExtendDays, planEnrollmentExtension, type EnrollmentLite } from "@/lib/cad-champions/admin/student-detail";
import { ccCallbackUrl, ccContinueHref } from "@/lib/cad-champions/auth/paths";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { markJourney } from "@/lib/cad-champions/journey/server";
import { ccPath } from "@/lib/cad-champions/routes";
import { finalizeAttempt } from "@/lib/cad-champions/test/server";

// Students pages actions (Prompt 11 Step D + in-person sessions). Notes are
// staff (instructor or admin); everything else is admin only. Every action
// re-checks the role on the server (adminGuard), validates its input and
// writes cc_audit_log for unlocks, bypasses, enrollment changes, flag
// resolutions, verification resends and in-person starts.

function revalidateStudent(studentId?: string) {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/students"));
    if (studentId) revalidatePath(ccPath(l, `/admin/students/${studentId}`));
  }
}

type Fail = Extract<ActionResult, { ok: false }>;
const fail = (error: Fail["error"], detail?: string): Fail => (detail ? { ok: false, error, detail } : { ok: false, error });
const dbFail = (code: string | undefined | null): Fail => (isMissingSchema(code) ? fail("not_set_up") : fail("error"));

// ------------------------------------------------------------------ notes (staff)

export type NoteView = { id: string; body: string; createdAt: string; authorName: string | null };

export async function addStudentNoteAction(input: { studentId: string; body: string }): Promise<ActionResult<NoteView>> {
  const g = await adminGuard("staff");
  if (!g.ok) return fail(g.error);
  const studentId = String(input?.studentId ?? "");
  const body = cleanNote(input?.body);
  if (!isUuid(studentId) || !body) return fail("invalid");
  const { data, error } = await g.db
    .from("cc_student_notes")
    .insert({ student_id: studentId, author_id: g.cc.user.id, body })
    .select("id,body,created_at")
    .maybeSingle<{ id: string; body: string; created_at: string }>();
  if (error) {
    if (error.code === "23503") return fail("not_found");
    console.error("[cc-admin] note insert failed:", error.code ?? error.message);
    return dbFail(error.code);
  }
  if (!data) return fail("error");
  revalidateStudent(studentId);
  return { ok: true, data: { id: data.id, body: data.body, createdAt: data.created_at, authorName: g.cc.profile?.full_name ?? g.cc.user.email ?? null } };
}

// ------------------------------------------------------------------ integrity flags (admin)

export async function resolveFlagAction(input: { studentId: string; flagId: string }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return fail(g.error);
  const flagId = String(input?.flagId ?? "");
  const studentId = String(input?.studentId ?? "");
  if (!isUuid(flagId)) return fail("invalid");
  const at = new Date().toISOString();
  const { data, error } = await g.db
    .from("cc_integrity_flags")
    .update({ resolved_at: at, resolved_by: g.cc.user.id })
    .eq("id", flagId)
    .is("resolved_at", null)
    .select("id,kind,attempt_id,user_id");
  if (error) return dbFail(error.code);
  const row = (data ?? [])[0] as { id: string; kind: string; attempt_id: string; user_id: string | null } | undefined;
  if (!row) return fail("conflict"); // already resolved (or gone)
  await writeAudit(g.db, g.cc.user.id, STUDENT_AUDIT_ACTIONS.resolveFlag, "cc_integrity_flags", flagId, { resolved_at: null }, { resolved_at: at, kind: row.kind, attempt_id: row.attempt_id });
  revalidateStudent(isUuid(studentId) ? studentId : (row.user_id ?? undefined));
  return { ok: true };
}

// ------------------------------------------------------------------ unlock level (admin)

export async function unlockLevelAction(input: { studentId: string; levelId: string }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return fail(g.error);
  const studentId = String(input?.studentId ?? "");
  const levelId = String(input?.levelId ?? "");
  if (!isUuid(studentId) || !isUuid(levelId)) return fail("invalid");
  const { data: level, error: lErr } = await g.db.from("cc_levels").select("id,level_number,title_en").eq("id", levelId).maybeSingle<{ id: string; level_number: number; title_en: string }>();
  if (lErr) return dbFail(lErr.code);
  if (!level) return fail("not_found");
  const { error } = await g.db.from("cc_level_unlocks").insert({ user_id: studentId, level_id: levelId, unlocked_by: g.cc.user.id });
  if (error) {
    if (error.code === "23505") return fail("conflict");
    if (error.code === "23503") return fail("not_found");
    console.error("[cc-admin] unlock failed:", error.code ?? error.message);
    return dbFail(error.code);
  }
  await writeAudit(g.db, g.cc.user.id, STUDENT_AUDIT_ACTIONS.unlockLevel, "cc_level_unlocks", `${studentId}:${levelId}`, null, {
    user_id: studentId,
    level_id: levelId,
    level_number: level.level_number,
    level_title: level.title_en,
  });
  revalidateStudent(studentId);
  return { ok: true };
}

// ------------------------------------------------------------------ Get Ready bypass (admin)

export async function setGetReadyBypassAction(input: { studentId: string; bypass: boolean }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return fail(g.error);
  const studentId = String(input?.studentId ?? "");
  const bypass = parseBool(input?.bypass);
  if (!isUuid(studentId) || bypass == null) return fail("invalid");
  const { data: before, error: rErr } = await g.db.from("cc_profiles").select("get_ready_bypass").eq("id", studentId).maybeSingle<{ get_ready_bypass: boolean }>();
  if (rErr) return dbFail(rErr.code);
  if (!before) return fail("not_found");
  if (before.get_ready_bypass === bypass) return { ok: true };
  const { error } = await g.db.from("cc_profiles").update({ get_ready_bypass: bypass }).eq("id", studentId);
  if (error) {
    console.error("[cc-admin] bypass failed:", error.code ?? error.message);
    return dbFail(error.code);
  }
  await writeAudit(g.db, g.cc.user.id, STUDENT_AUDIT_ACTIONS.getReadyBypass, "cc_profiles", studentId, { get_ready_bypass: before.get_ready_bypass }, { get_ready_bypass: bypass });
  revalidateStudent(studentId);
  return { ok: true };
}

// ------------------------------------------------------------------ extend enrollment (admin)

export async function extendEnrollmentAction(input: { studentId: string; days: number | string }): Promise<ActionResult<{ endsAt: string; created: boolean }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return fail(g.error);
  const studentId = String(input?.studentId ?? "");
  const days = parseExtendDays(input?.days);
  if (!isUuid(studentId) || days == null) return fail("invalid");
  const { data: exists } = await g.db.from("cc_profiles").select("id").eq("id", studentId).maybeSingle<{ id: string }>();
  if (!exists) return fail("not_found");

  const { data: rows, error } = await g.db.from("cc_enrollments").select("id,status,starts_at,ends_at").eq("user_id", studentId).eq("status", "active");
  if (error) return dbFail(error.code);
  const plan = planEnrollmentExtension((rows ?? []) as EnrollmentLite[], days, Date.now());

  if (plan.kind === "extend") {
    // Only while it still ends where we read it (no double extension on a double click).
    const { data: upd, error: uErr } = await g.db
      .from("cc_enrollments")
      .update({ ends_at: plan.endsAt, reminder_7d_sent_at: null, reminder_1d_sent_at: null })
      .eq("id", plan.enrollmentId)
      .eq("ends_at", plan.fromEndsAt)
      .select("id");
    if (uErr) {
      // Before 0084 the reminder columns do not exist: retry without them.
      if (isMissingSchema(uErr.code)) {
        const again = await g.db.from("cc_enrollments").update({ ends_at: plan.endsAt }).eq("id", plan.enrollmentId).eq("ends_at", plan.fromEndsAt).select("id");
        if (again.error) return dbFail(again.error.code);
        if (!again.data?.length) return fail("conflict");
      } else return dbFail(uErr.code);
    } else if (!upd?.length) return fail("conflict");
    await writeAudit(g.db, g.cc.user.id, STUDENT_AUDIT_ACTIONS.extendEnrollment, "cc_enrollments", plan.enrollmentId, { ends_at: plan.fromEndsAt }, { ends_at: plan.endsAt, days });
    revalidateStudent(studentId);
    return { ok: true, data: { endsAt: plan.endsAt, created: false } };
  }

  const { data: created, error: cErr } = await g.db
    .from("cc_enrollments")
    .insert({ user_id: studentId, source: "admin", status: "active", starts_at: plan.startsAt, ends_at: plan.endsAt })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (cErr || !created) {
    console.error("[cc-admin] admin enrollment failed:", cErr?.code ?? cErr?.message ?? "no row");
    return dbFail(cErr?.code);
  }
  await markJourney(studentId, "enrolled_at");
  await writeAudit(g.db, g.cc.user.id, STUDENT_AUDIT_ACTIONS.createEnrollment, "cc_enrollments", created.id, null, {
    user_id: studentId,
    source: "admin",
    starts_at: plan.startsAt,
    ends_at: plan.endsAt,
    days,
  });
  revalidateStudent(studentId);
  return { ok: true, data: { endsAt: plan.endsAt, created: true } };
}

// ------------------------------------------------------------------ resend verification (admin)

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Sends the sign-up confirmation email again (the same Supabase "signup"
 * email the app sends at sign-up, through the CC callback). Already
 * confirmed -> nothing is sent and the UI says so.
 */
export async function resendVerificationAction(input: { studentId: string }): Promise<ActionResult<{ state: "sent" | "confirmed" | "no_email" }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return fail(g.error);
  const studentId = String(input?.studentId ?? "");
  if (!isUuid(studentId)) return fail("invalid");
  try {
    const { data, error } = await g.db.auth.admin.getUserById(studentId);
    if (error || !data?.user) return fail("not_found");
    const state = verificationState(data.user);
    if (state !== "unconfirmed") return { ok: true, data: { state } };
    const { data: prof } = await g.db.from("cc_profiles").select("preferred_locale").eq("id", studentId).maybeSingle<{ preferred_locale: string }>();
    const locale = prof?.preferred_locale === "ar" ? "ar" : "en";
    const { error: sendErr } = await g.db.auth.resend({
      type: "signup",
      email: data.user.email!,
      options: { emailRedirectTo: ccCallbackUrl(await requestOrigin(), ccContinueHref(locale)) },
    });
    if (sendErr) {
      console.error("[cc-admin] resend verification failed:", sendErr.status ?? sendErr.message);
      return fail("error", sendErr.status === 429 ? "rate_limited" : undefined);
    }
    await writeAudit(g.db, g.cc.user.id, STUDENT_AUDIT_ACTIONS.resendVerification, "auth.users", studentId, null, { sent: true });
    return { ok: true, data: { state: "sent" } };
  } catch (e) {
    console.error("[cc-admin] resend verification failed:", e instanceof Error ? e.message : "unknown");
    return fail("error");
  }
}

// ------------------------------------------------------------------ in-person session (admin)

export async function startInPersonAction(input: { testId: string; studentIds: string[] }): Promise<ActionResult<Extract<InPersonStartResult, { ok: true }>>> {
  const g = await adminGuard("admin");
  if (!g.ok) return fail(g.error);
  const res = await startInPersonAttempts(g.db, { testId: String(input?.testId ?? ""), studentIds: input?.studentIds, actorId: g.cc.user.id }, async (attempt, testType) => {
    await finalizeAttempt(attempt, "timeout", null, testType);
  });
  if (!res.ok) return fail(res.error, res.detail);
  for (const l of CC_LOCALES) revalidatePath(ccPath(l, "/admin/students/in-person"));
  for (const s of res.started) revalidateStudent(s.studentId);
  return { ok: true, data: res };
}
