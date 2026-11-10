// verifyUserToken(): the worker-side check of a token minted by
// POST /api/worker-token (lib/worker/token.ts). Part B's user-facing
// endpoints call it on `Authorization: Bearer <token>`.
//
// It proves who the caller is and which project they owned when the token was
// minted (at most 10 minutes ago). It does NOT prove they can pay: credits are
// never read from the token. Before any paid step the job must check and
// spend credits in the database (service role: credit_can_use /
// spend_credit_for / idea_token_charge), and re-check project ownership for
// anything it writes.

import { verifyWorkerToken, WORKER_TOKEN_AUDIENCE, type VerifyResult } from "@/lib/worker/token";

export function verifyUserToken(
  authorization: string | string[] | undefined | null,
  secret: string,
  opts: { nowMs?: number } = {},
): VerifyResult {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? "");
  if (!m) return { ok: false, error: "malformed" };
  return verifyWorkerToken(m[1], secret, { nowMs: opts.nowMs, audience: WORKER_TOKEN_AUDIENCE });
}
