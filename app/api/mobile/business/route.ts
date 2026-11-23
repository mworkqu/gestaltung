import { requireSuperAdminBearer } from "@/lib/auth/bearer";
import { jsonError, jsonOk } from "@/lib/http";
import { loadBusiness, searchCatalogue } from "@/lib/mobile/business-server";
import { createRateLimiter } from "@/lib/rate-limit";

// GET /api/mobile/business — supply, inventory and demand for the dashboards.
//
// Read-only, and the same admin-only bearer check as /api/mobile/summary: the
// app signs the owner in with the publishable key and sends their access token;
// this route verifies it and requires profiles.role = 'super_admin'.
//
// Query:
//   (none)        the three sections
//   ?q=screw      catalogue search for the "add an item" screen
//   ?test=1       include parts and orders flagged is_test
//
// Answers 200, 401 sign_in, 403 forbidden, 429 rate_limited, 503 unavailable.
// Never cached. Rate limit: 60 per minute per admin, per server instance.

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
  const q = url.searchParams.get("q");
  const includeTest = url.searchParams.get("test") === "1";

  if (q !== null) {
    const hits = await searchCatalogue(q);
    if (!hits.ok) return jsonError("unavailable", 503);
    return jsonOk({ parts: hits.data }, { headers: NO_STORE });
  }

  const res = await loadBusiness({ includeTest });
  if (!res.ok) return jsonError("unavailable", 503);
  return jsonOk(res.data, { headers: NO_STORE });
}
