// Short-lived user tokens for the Mac Mini worker (Phase 3 part B).
//
// POST /api/worker-token mints one for the signed-in user (guests included);
// the browser then calls the worker directly with it. HS256 JWT signed with
// WORKER_SECRET, 10 minutes, audience "gestaltung-worker". Implemented with
// node:crypto (no JWT dependency); pure, no Next, no Supabase, so the worker
// bundles it too (services/worker/src/user-token.ts).
//
// What the token is NOT: a credit balance or a price. It says who the user is,
// which project they were allowed to work on when it was minted, the project's
// stored tier and whether they are an admin. The worker must still spend or
// check credits through the database (spend_credit_for / credit_can_use,
// service role) at the moment it does the paid work, and must re-check project
// ownership for anything it writes. A token can be replayed for its 10 minutes.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { MIN_WORKER_SECRET_LENGTH } from "@/lib/worker/settings";

export const WORKER_TOKEN_AUDIENCE = "gestaltung-worker";
export const WORKER_TOKEN_ISSUER = "gestaltung360.com";
export const WORKER_TOKEN_TTL_SEC = 600;
/** Clock skew tolerated between Vercel and the Mac Mini. */
export const WORKER_TOKEN_LEEWAY_SEC = 30;

export type WorkerTokenInput = {
  userId: string;
  projectId?: string | null;
  tier?: string | null;
  isAdmin: boolean;
  isAnonymous: boolean;
};

export type WorkerTokenClaims = {
  iss: string;
  aud: string;
  sub: string;
  /** Project the user owned (or administers) when the token was minted; null = no project. */
  pid: string | null;
  /** The project's stored idea tier (lib/studio/tiers.ts TierId) or null. Informational. */
  tier: string | null;
  adm: boolean;
  anon: boolean;
  iat: number;
  exp: number;
  jti: string;
};

export type VerifyError = "malformed" | "bad_alg" | "bad_signature" | "expired" | "not_yet_valid" | "bad_audience" | "bad_issuer" | "bad_claims";
export type VerifyResult = { ok: true; claims: WorkerTokenClaims } | { ok: false; error: VerifyError };

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function assertSecret(secret: string | null | undefined): asserts secret is string {
  if (!secret || secret.length < MIN_WORKER_SECRET_LENGTH) throw new Error("worker_secret_too_short");
}

function sign(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signWorkerToken(
  input: WorkerTokenInput,
  secret: string | null | undefined,
  opts: { nowMs?: number; ttlSec?: number } = {},
): { token: string; claims: WorkerTokenClaims } {
  assertSecret(secret);
  const iat = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const claims: WorkerTokenClaims = {
    iss: WORKER_TOKEN_ISSUER,
    aud: WORKER_TOKEN_AUDIENCE,
    sub: input.userId,
    pid: input.projectId ?? null,
    tier: input.tier ?? null,
    adm: input.isAdmin,
    anon: input.isAnonymous,
    iat,
    exp: iat + (opts.ttlSec ?? WORKER_TOKEN_TTL_SEC),
    jti: randomUUID(),
  };
  const body = `${enc(HEADER)}.${enc(claims)}`;
  return { token: `${body}.${sign(body, secret).toString("base64url")}`, claims };
}

function decodeJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function isClaims(v: unknown): v is WorkerTokenClaims {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.sub === "string" &&
    c.sub.length > 0 &&
    (c.pid === null || typeof c.pid === "string") &&
    (c.tier === null || typeof c.tier === "string") &&
    typeof c.adm === "boolean" &&
    typeof c.anon === "boolean" &&
    Number.isInteger(c.iat) &&
    Number.isInteger(c.exp) &&
    typeof c.aud === "string" &&
    typeof c.iss === "string"
  );
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export function verifyWorkerToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  opts: { nowMs?: number; audience?: string } = {},
): VerifyResult {
  assertSecret(secret);
  if (!token || token.length > 4096) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => p.length > 0 && B64URL.test(p))) return { ok: false, error: "malformed" };
  const [h, p, s] = parts as [string, string, string];

  const header = decodeJson(h) as Record<string, unknown> | null;
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") return { ok: false, error: "bad_alg" };

  const want = sign(`${h}.${p}`, secret);
  const got = Buffer.from(s, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, error: "bad_signature" };

  const claims = decodeJson(p);
  if (!isClaims(claims)) return { ok: false, error: "bad_claims" };
  if (claims.aud !== (opts.audience ?? WORKER_TOKEN_AUDIENCE)) return { ok: false, error: "bad_audience" };
  if (claims.iss !== WORKER_TOKEN_ISSUER) return { ok: false, error: "bad_issuer" };
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (claims.iat > now + WORKER_TOKEN_LEEWAY_SEC) return { ok: false, error: "not_yet_valid" };
  if (claims.exp <= now - WORKER_TOKEN_LEEWAY_SEC) return { ok: false, error: "expired" };
  if (claims.exp - claims.iat > WORKER_TOKEN_TTL_SEC) return { ok: false, error: "bad_claims" };
  return { ok: true, claims };
}
