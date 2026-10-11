import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleClaimGuest, sameOrigin } from "@/lib/auth/claim-guest";
import { claimGuestDeps } from "@/lib/auth/claim-guest-server";

// POST /api/auth/claim-guest  { token: <the guest's anonymous access token> }
//
// W1 (2026-10-11): after a guest signs in to an EXISTING account, the sign-in
// form posts the anonymous token it kept in memory. The rules (token verifies,
// is anonymous, the cookie session is a real account, the two differ) are in
// lib/auth/claim-guest.ts; the move itself is claim_guest_work (migration 0071,
// service_role only, idempotent). The token is never logged or stored.

export const dynamic = "force-dynamic";

const MAX_BODY = 16_384;

export async function POST(request: Request) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 415 });
  }

  let body: unknown = null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return Response.json({ ok: false, error: "bad_request" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const service = createServiceClient();
  if (!service) return Response.json({ ok: false, error: "claim_failed" }, { status: 500 });
  const supabase = await createClient();

  const out = await handleClaimGuest(body, claimGuestDeps(supabase, service));

  return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}
