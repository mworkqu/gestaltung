// Admin student actions (Prompt 11 Step D) — pure decisions shared by the
// server actions in app/[locale]/cad-champions/admin/students/actions.ts and
// their tests. No I/O.

/** What "Resend verification email" should do for this auth user. */
export type VerificationState = "unconfirmed" | "confirmed" | "no_email";

export function verificationState(user: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null): VerificationState {
  if (!user?.email) return "no_email";
  return user.email_confirmed_at || user.confirmed_at ? "confirmed" : "unconfirmed";
}

/** "true"/"1"/true -> true, "false"/"0"/false -> false, else null. */
export function parseBool(raw: unknown): boolean | null {
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  return null;
}

/** Audit action names used by the Students pages (one place, so the audit viewer can label them). */
export const STUDENT_AUDIT_ACTIONS = {
  unlockLevel: "level.unlock",
  getReadyBypass: "student.get_ready_bypass",
  extendEnrollment: "enrollment.extend",
  createEnrollment: "enrollment.admin_create",
  resendVerification: "student.resend_verification",
  resolveFlag: "integrity.resolve",
  inPersonStart: "attempt.in_person_start",
} as const;
