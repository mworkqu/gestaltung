import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { submitProof } from "@/lib/billing/server";

// POST /api/billing/proof {paymentId, path} — the user uploaded their Fawran
// screenshot to payment-proofs/<userId>/…; we check it automatically
// (lib/billing/verify.ts) and grant at once, or mark it "needs review".
// Answers {status: "approved" | "needs_review", reasons}.

export const dynamic = "force-dynamic";
// One vision call (45 s) + a retry.
export const maxDuration = 120;

const Body = z.object({ paymentId: z.string().uuid(), path: z.string().min(3).max(300) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const r = await submitProof(supabase, user.id, parsed.data.paymentId, parsed.data.path);
  if (!r.ok) {
    const status = { not_found: 404, not_open: 409, bad_file: 400, not_configured: 503, failed: 500 }[r.error];
    return Response.json({ error: r.error }, { status });
  }
  return Response.json({ status: r.status, reasons: r.reasons });
}
