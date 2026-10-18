import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createPayment } from "@/lib/billing/server";

// POST /api/billing/checkout {product} — opens a Fawran payment for a token pack
// or the Maker Pass (lib/billing/config.ts sets the amount, never the browser).
// Answers {payment} with the reference code the user writes in the transfer note.
// Signed-in accounts only (not guests).

export const dynamic = "force-dynamic";

const Body = z.object({ product: z.string().max(40) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const r = await createPayment(user.id, parsed.data.product);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === "bad_product" ? 400 : r.error === "not_configured" ? 503 : 500 });
  return Response.json({ payment: r.payment });
}
