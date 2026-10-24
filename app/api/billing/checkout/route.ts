import { z } from "zod";

import { createPayment } from "@/lib/billing/server";
import { requireAccount } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";

// POST /api/billing/checkout {product} — opens a Fawran payment for a token pack
// or the Maker Pass (lib/billing/config.ts sets the amount, never the browser).
// Answers {payment} with the reference code the user writes in the transfer note.
// Signed-in accounts only (not guests).

export const dynamic = "force-dynamic";

const Body = z.object({ product: z.string().max(40) });

export async function POST(request: Request) {
  const auth = await requireAccount();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("bad_request", 400);

  const r = await createPayment(user.id, parsed.data.product);
  if (!r.ok) return jsonError(r.error, r.error === "bad_product" ? 400 : r.error === "not_configured" ? 503 : 500);
  return jsonOk({ payment: r.payment });
}
