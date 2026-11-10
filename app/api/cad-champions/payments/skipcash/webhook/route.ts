import { handleSkipCashWebhook } from "@/lib/cad-champions/payments/server";

// SkipCash webhook (Prompt 10 Step E). No session: authenticity comes from
// the HMAC-SHA256 signature in the Authorization header (constant-time check,
// refused when SKIPCASH_WEBHOOK_KEY is unset). Then the payment is fetched
// from SkipCash and its amount + currency confirmed before it is marked paid;
// a late or replayed "pending" never moves a paid payment backwards.
// SkipCash only checks for HTTP 200 and retries otherwise.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { status, body } = await handleSkipCashWebhook(req);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[cc-skipcash] webhook failed:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "error" }, { status: 500 });
  }
}

export async function GET() {
  return new Response(null, { status: 405 });
}
