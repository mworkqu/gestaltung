import { requireSuperAdminBearer } from "@/lib/auth/bearer";
import { jsonError, jsonOk } from "@/lib/http";
import { parseProductEdit } from "@/lib/mobile/products";
import { editProduct, loadProducts } from "@/lib/mobile/products-server";
import { createRateLimiter } from "@/lib/rate-limit";

// GET /api/mobile/products — the catalogue the apps browse, one category at a
// time, each item with a thumbnail.
// PATCH /api/mobile/products — fix one product's name or price.
//
// Why this exists next to /api/mobile/report: the report answers with the whole
// website in one generic shape, which is right for figures and wrong for
// browsing. This read is small and typed, so picking a category or saving a
// name does not re-run a few dozen selects.
//
// Auth is the same admin-only bearer check as every other mobile route: the app
// carries no secret, and an ordinary signed-in customer is refused with 403.
//
// The PATCH can change exactly two columns, `name` and `unit_price`, on one
// product that exists and is not a merged duplicate. It cannot publish or
// unpublish, change a category or a stock status, touch another table, or
// delete anything. (Before this route, /api/mobile/stock was the only mobile
// route that wrote at all; it is still the only one that can create a row.)
//
// GET query: ?category=<key> (omit for everything), ?limit=1..500 (default 100).
// PATCH body: { "partId": "<uuid>", "name"?: string, "unitPrice"?: number }
//
// Answers 200, 400 bad_request, 401 sign_in, 403 forbidden, 404 not_found,
// 413 payload_too_large, 415 unsupported_media_type, 429 rate_limited,
// 503 unavailable. Never cached.

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Browsing is cheap, so the read is allowed more often than the report; writes
// are rarer and get their own, tighter budget.
const readRate = createRateLimiter({ limit: 60, windowMs: 60_000 });
const writeRate = createRateLimiter({ limit: 30, windowMs: 60_000 });

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_BYTES = 4_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: Request) {
  const auth = await requireSuperAdminBearer(request);
  if (!auth.ok) return auth.response;

  const limited = readRate.hit(auth.user.id);
  if (!limited.allowed) return jsonError("rate_limited", 429, { retryAfter: limited.retryAfterSec });

  const url = new URL(request.url);
  const category = url.searchParams.get("category")?.trim().toLowerCase() || null;

  const asked = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT;

  const res = await loadProducts({ category, limit });
  if (!res.ok) return jsonError("unavailable", 503);

  return jsonOk(res.data, { headers: NO_STORE });
}

export async function PATCH(request: Request) {
  const auth = await requireSuperAdminBearer(request);
  if (!auth.ok) return auth.response;

  const limited = writeRate.hit(auth.user.id);
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

  const parsed = parseProductEdit(body);
  if (!parsed.ok) return jsonError("bad_request", 400, { field: parsed.error });

  const res = await editProduct(parsed.value);
  if (!res.ok) return jsonError(res.error === "not_found" ? "not_found" : "unavailable", res.error === "not_found" ? 404 : 503);

  return jsonOk(res.data, { headers: NO_STORE });
}
