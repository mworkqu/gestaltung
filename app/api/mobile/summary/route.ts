import { requireSuperAdminBearer } from "@/lib/auth/bearer";
import { jsonError, jsonOk } from "@/lib/http";
import { loadDetail, loadSummary } from "@/lib/mobile/summary-server";
import { createRateLimiter } from "@/lib/rate-limit";
import { isUuid } from "@/lib/uuid";

// GET /api/mobile/summary — read-only dashboard feed for the iOS app.
//
// Auth: Authorization: Bearer <Supabase access token> of a super_admin account
// (lib/auth/bearer.ts). The app signs in to Supabase with the public anon key
// and sends the token it gets; no secret of ours ships in the app.
//
// Query:
//   ?project=<uuid>  one idea in full instead of the list
//   ?test=1          include projects flagged is_test
//
// Answers 200 with the summary (or the detail), 401 sign_in, 403 forbidden,
// 404 not_found, 429 rate_limited, 503 unavailable. Never cached.
// Rate limit: 60 per minute per admin, per server instance.

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const rate = createRateLimiter({ limit: 60, windowMs: 60_000 });

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(request: Request) {
  const auth = await requireSuperAdminBearer(request);
  if (!auth.ok) return auth.response;

  const limited = rate.hit(auth.user.id);
  if (!limited.allowed) return jsonError("rate_limited", 429, { retryAfter: limited.retryAfterSec });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project");
  const includeTest = url.searchParams.get("test") === "1";

  if (projectId !== null) {
    if (!isUuid(projectId)) return jsonError("bad_request", 400);
    const detail = await loadDetail(projectId);
    if (!detail.ok) return jsonError(detail.error, detail.error === "not_found" ? 404 : 503);
    return jsonOk(detail.data, { headers: NO_STORE });
  }

  const summary = await loadSummary({ includeTest });
  if (!summary.ok) return jsonError(summary.error, 503);
  return jsonOk(summary.data, { headers: NO_STORE });
}
