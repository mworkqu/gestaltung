// A failed Studio call → the Studio message key to show (plain words only).
// sign_in / no_credits are not here: they show the AccessNote instead.

export type StudioProblemKey = "busy" | "failed" | "dailyLimit" | "consentNeeded";

export function problemKey(r: { status: number; error: string }): StudioProblemKey {
  if (r.error === "daily_limit") return "dailyLimit";
  if (r.error === "consent" || r.status === 403) return "consentNeeded";
  if (r.status === 429 || r.status === 503 || r.error === "paused" || r.error === "rate_limited" || r.error === "unavailable")
    return "busy";
  return "failed";
}

/** Credit refusals the AccessNote explains (sign in / buy credits). */
export function accessReason(r: { status: number; error: string }): "sign_in" | "no_credits" | null {
  if (r.status === 401 || r.error === "sign_in") return "sign_in";
  if (r.status === 402 || r.error === "no_credits") return "no_credits";
  return null;
}
