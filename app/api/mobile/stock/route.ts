import { requireSuperAdminBearer } from "@/lib/auth/bearer";
import { jsonError, jsonOk } from "@/lib/http";
import { addStock } from "@/lib/mobile/business-server";
import { parseAddStock } from "@/lib/mobile/business";
import { createRateLimiter } from "@/lib/rate-limit";

// POST /api/mobile/stock — put units on our own shelf from the dashboards.
//
// This is the ONLY route in /api/mobile that writes anything, and it can touch
// exactly two things: a new row in `parts` (unpublished) and the own-stock
// count for one product. It cannot edit orders, customers, projects or prices.
//
// Auth is the same admin-only bearer check as the read routes, so nothing
// changes about what a stolen app binary could do: the app carries no secret,
// and an ordinary signed-in customer is refused with 403.
//
// Body (JSON), one of:
//   { "partId": "<uuid>", "qty": 12 }                       count an existing part
//   { "newPart": { "name": "M3 screw", "unitPrice": 2 }, "qty": 12 }
//
// A new part is created unpublished, so it does not appear in the shop until
// the owner finishes filling it in on the website. Above zero the product also
// gets the own-stock offer at 1 day, which is what puts our own shelf ahead of
// Voltaat, DigiKey and Mouser (docs/SOURCING_ORDER.md).
//
// Answers 200, 400 bad_request, 401 sign_in, 403 forbidden, 404 not_found,
// 413 payload_too_large, 415 unsupported_media_type, 429 rate_limited,
// 503 unavailable. Never cached.
// Rate limit: 30 writes per minute per admin, per server instance.

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const rate = createRateLimiter({ limit: 30, windowMs: 60_000 });

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_BYTES = 4_000;

export async function POST(request: Request) {
  const auth = await requireSuperAdminBearer(request);
  if (!auth.ok) return auth.response;

  const limited = rate.hit(auth.user.id);
  if (!limited.allowed) return jsonError("rate_limited", 429, { retryAfter: limited.retryAfterSec });

  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return jsonError("unsupported_media_type", 415);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return jsonError("payload_too_large", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError("bad_request", 400, { field: "json" });
  }

  const parsed = parseAddStock(body, new Date());
  if (!parsed.ok) return jsonError("bad_request", 400, { field: parsed.error });

  const res = await addStock(parsed.value);
  if (!res.ok) return jsonError(res.error === "not_found" ? "not_found" : "unavailable", res.error === "not_found" ? 404 : 503);

  return jsonOk(res.data, { headers: NO_STORE });
}
