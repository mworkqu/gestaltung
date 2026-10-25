// Moving a guest's work to the account they just signed in to (W1, 2026-10-11).
//
// The route (app/api/auth/claim-guest) wires real Supabase calls into
// handleClaimGuest(); the rules live here so they are unit-tested:
//   1. the body carries the guest's ANONYMOUS access token (kept in memory by
//      the sign-in form before signInWithPassword swapped the session);
//   2. the new session (cookies) must be a real account, not anonymous;
//   3. the token must verify server-side (auth.getUser(token)) and belong to an
//      anonymous user;
//   4. the two users must differ;
//   5. only then claim_guest_work(p_from, p_to) runs (migration 0071,
//      service_role only), which re-checks all of it and is idempotent.
// Nothing here trusts a user id sent by the browser.

import { isMissingFunction as isMissingFunctionCode } from "@/lib/supabase/errors";

export type ClaimUser = { id: string; is_anonymous?: boolean | null };

export type ClaimRpcResult =
  | { ok: true; data: unknown }
  | { ok: false; missing?: boolean; message?: string };

export type ClaimDeps = {
  /** The signed-in user from the request cookies (auth.getUser()), or null. */
  sessionUser(): Promise<ClaimUser | null>;
  /** The user a bearer token belongs to (auth.getUser(token)), or null when it does not verify. */
  userFromToken(token: string): Promise<ClaimUser | null>;
  /** claim_guest_work(p_from, p_to) with the service role. */
  claim(from: string, to: string): Promise<ClaimRpcResult>;
};

export type ClaimOutcome = { status: number; body: Record<string, unknown> };

export type ClaimError =
  | "bad_request"
  | "sign_in"
  | "not_an_account"
  | "invalid_token"
  | "not_guest"
  | "same_user"
  | "run_0071"
  | "claim_failed";

/** A JWT: three base64url parts. Generous length bounds, never logged. */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function readClaimToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string") return null;
  if (token.length < 20 || token.length > 8192 || !JWT.test(token)) return null;
  return token;
}

const fail = (status: number, error: ClaimError): ClaimOutcome => ({ status, body: { ok: false, error } });

export async function handleClaimGuest(body: unknown, deps: ClaimDeps): Promise<ClaimOutcome> {
  const token = readClaimToken(body);
  if (!token) return fail(400, "bad_request");

  const to = await deps.sessionUser();
  if (!to?.id) return fail(401, "sign_in");
  if (to.is_anonymous === true) return fail(403, "not_an_account");

  const from = await deps.userFromToken(token);
  if (!from?.id) return fail(401, "invalid_token");
  if (from.is_anonymous !== true) return fail(403, "not_guest");
  if (from.id === to.id) return fail(400, "same_user");

  const r = await deps.claim(from.id, to.id);
  if (!r.ok) return r.missing ? fail(503, "run_0071") : fail(500, "claim_failed");

  // The RPC answers {ok:false, reason} for its own re-checks (guest gone, …).
  const data = (r.data ?? {}) as Record<string, unknown>;
  if (data.ok === false) return { status: 409, body: { ok: false, error: "claim_failed", reason: data.reason ?? null } };
  return { status: 200, body: { ok: true, moved: data } };
}

/** PostgREST / Postgres "function does not exist" (migration not run yet). */
export function isMissingFunction(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (isMissingFunctionCode(e) || /could not find the function/i.test(e.message ?? ""));
}

/**
 * Same-origin check for a cookie-authenticated POST: when the browser sends an
 * Origin header it must match the host we are served on. No Origin = a
 * same-origin fetch from an older browser or a server call: allowed (the token
 * still has to verify).
 */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
