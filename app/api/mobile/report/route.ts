import { requireSuperAdminBearer } from "@/lib/auth/bearer";
import { jsonError, jsonOk } from "@/lib/http";
import { loadReport } from "@/lib/mobile/report-server";
import { createRateLimiter } from "@/lib/rate-limit";

// GET /api/mobile/report — the whole-website report for the iOS/iPadOS app:
// store, sourcing, orders, people, champions, CAD & AI, traffic.
//
// Auth is the same as /api/mobile/summary: Authorization: Bearer <Supabase
// access token> of a super_admin account (lib/auth/bearer.ts). The app signs in
// with the public anon key and sends the token it gets; no secret of ours ships
// in the app.
//
// Answers 200 with the report, 401 sign_in, 403 forbidden, 429 rate_limited,
// 503 unavailable. Never cached.
//
// The rate limit is tighter than the summary's (12 a minute, not 60): one call
// here is a few dozen selects, so it is a refresh button, not a poll.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rate = createRateLimiter({ limit: 12, windowMs: 60_000 });

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(request: Request) {
  const auth = await requireSuperAdminBearer(request);
  if (!auth.ok) return auth.response;

  const limited = rate.hit(auth.user.id);
  if (!limited.allowed) return jsonError("rate_limited", 429, { retryAfter: limited.retryAfterSec });

  const report = await loadReport();
  if (!report.ok) return jsonError(report.error, 503);
  return jsonOk(report.data, { headers: NO_STORE });
}
