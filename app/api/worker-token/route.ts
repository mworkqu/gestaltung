import { z } from "zod";

import { requireUser } from "@/lib/auth/guards";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { createRateLimiter } from "@/lib/rate-limit";
import { isUuid } from "@/lib/uuid";
import { MIN_WORKER_SECRET_LENGTH } from "@/lib/worker/settings";
import { mintWorkerTokenFor } from "@/lib/worker/token-server";

// POST /api/worker-token — a 10-minute token the browser shows the Mac Mini
// worker (Phase 3 part B: long AI and CAD steps run there). Needs a Supabase
// session; guest (anonymous) sessions are allowed, as on today's AI routes.
// Body (JSON, optional fields): {projectId?: uuid}. The project must be the
// caller's own (or the caller a super_admin), else 404 not_found.
// Answers {token, expiresAt, projectId, tier, isAdmin}. HS256 JWT signed with
// WORKER_SECRET (lib/worker/token.ts): user id, project id, the project's
// stored tier, is_admin — never credits; the worker checks and spends credits
// in the database. 503 worker_unavailable while WORKER_SECRET is unset.
// Rate limit: 20 per minute per user, per server instance.

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const rate = createRateLimiter({ limit: 20, windowMs: 60_000 });

const Body = z.object({ projectId: z.string().refine(isUuid).nullish() }).strict();

export async function POST(request: Request) {
  const secret = process.env.WORKER_SECRET ?? "";
  if (secret.length < MIN_WORKER_SECRET_LENGTH) return jsonError("worker_unavailable", 503);

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const limited = rate.hit(auth.user.id);
  if (!limited.allowed) return jsonError("rate_limited", 429, { retryAfter: limited.retryAfterSec });

  const parsed = await parseJsonBody(request, Body, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;

  const minted = await mintWorkerTokenFor(auth.supabase, auth.user, parsed.data.projectId ?? null, secret);
  if (!minted.ok) return jsonError(minted.error, 404);
  return jsonOk(
    { token: minted.token, expiresAt: minted.expiresAt, projectId: minted.projectId, tier: minted.tier, isAdmin: minted.isAdmin },
    { headers: { "cache-control": "no-store" } },
  );
}
