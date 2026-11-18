import { getCcUser } from "@/lib/cad-champions/auth/server";
import { jsonError } from "@/lib/http";
import { refreshPaymentStatus } from "@/lib/cad-champions/payments/server";
import { ccRateLimited } from "@/lib/cad-champions/rate-limits";

// Live status of one payment for the SkipCash return page ("Confirming your
// payment..."), polled every few seconds. Owner only. For an unpaid SkipCash
// payment it also asks SkipCash directly, in case the webhook is late.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cc = await getCcUser();
  if (!cc) return jsonError("signed_out", 401, undefined, NO_STORE);
  if (ccRateLimited("poll", cc.user.id)) return jsonError("rate_limited", 429, undefined, { ...NO_STORE, "Retry-After": "30" });
  const res = await refreshPaymentStatus(cc, id);
  if (!res) return jsonError("not_found", 404, undefined, NO_STORE);
  return Response.json(res, { headers: NO_STORE });
}
