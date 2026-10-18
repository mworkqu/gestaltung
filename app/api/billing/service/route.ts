import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createServicePayment } from "@/lib/services/server";
import { SERVICE_KINDS } from "@/lib/services/quote";

// POST /api/billing/service {projectId, service, note?} — opens a Fawran payment
// for an engineer service (assembly | cad_engineer | pcb_gerber). The price is the
// server's quote from the saved Studio doc (lib/services/quote.ts). Answers
// {payment, quote}; the proof then goes to /api/billing/proof like any payment,
// and approval opens the engineering job (migration 0092).

export const dynamic = "force-dynamic";

const Body = z.object({
  projectId: z.string().uuid(),
  service: z.enum(SERVICE_KINDS),
  note: z.string().max(1000).optional().default(""),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const r = await createServicePayment(supabase, user.id, parsed.data.projectId, parsed.data.service, parsed.data.note);
  if (!r.ok) {
    const status = { not_found: 404, not_ready: 409, already_open: 409, not_configured: 503, failed: 500 }[r.error];
    return Response.json({ error: r.error }, { status });
  }
  return Response.json({ payment: r.payment, quote: r.quote });
}
