import { getCcUser } from "@/lib/cad-champions/auth/server";
import { refreshPaymentStatus } from "@/lib/cad-champions/payments/server";

// Live status of one payment for the SkipCash return page ("Confirming your
// payment..."), polled every few seconds. Owner only. For an unpaid SkipCash
// payment it also asks SkipCash directly, in case the webhook is late.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cc = await getCcUser();
  if (!cc) return Response.json({ error: "signed_out" }, { status: 401, headers: NO_STORE });
  const res = await refreshPaymentStatus(cc, id);
  if (!res) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  return Response.json(res, { headers: NO_STORE });
}
