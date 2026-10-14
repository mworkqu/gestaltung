// Supabase auth error -> friendly CC message key (CC.auth.errors.<code>).
// Pure; tested in errors.test.ts. Raw error text is never shown to a user.

export type CcAuthErrorCode =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "rateLimited"
  | "userExists"
  | "weakPassword"
  | "captcha"
  | "linkExpired"
  | "samePassword"
  | "network"
  | "unknown";

export type CcAuthError = { code: CcAuthErrorCode; retryAfterSec?: number };

type RawError = { code?: string | null; message?: string | null; status?: number | null; name?: string | null } | null | undefined;

/** "…only request this after 42 seconds." -> 42 */
export function retryAfterFrom(message: string | null | undefined): number | undefined {
  const m = /after (\d+) seconds?/i.exec(message ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function mapAuthError(err: RawError): CcAuthError {
  if (!err) return { code: "unknown" };
  const code = (err.code ?? "").toLowerCase();
  const msg = (err.message ?? "").toLowerCase();
  const status = err.status ?? 0;

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return { code: "invalidCredentials" };
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return { code: "emailNotConfirmed" };
  if (
    status === 429 ||
    code.startsWith("over_") ||
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("security purposes")
  ) {
    return { code: "rateLimited", retryAfterSec: retryAfterFrom(err.message) };
  }
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return { code: "userExists" };
  if (code === "weak_password" || msg.includes("password should")) return { code: "weakPassword" };
  if (code.startsWith("captcha") || msg.includes("captcha")) return { code: "captcha" };
  if (code === "same_password" || msg.includes("should be different")) return { code: "samePassword" };
  if (code === "otp_expired" || code === "flow_state_expired" || msg.includes("expired")) return { code: "linkExpired" };
  if (err.name === "AuthRetryableFetchError" || msg.includes("failed to fetch") || msg.includes("network")) return { code: "network" };
  return { code: "unknown" };
}
