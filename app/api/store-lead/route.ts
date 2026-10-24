import { jsonError, jsonOk } from "@/lib/http";
import { leadAllowed } from "@/lib/leads/gate";
import { leadDeps } from "@/lib/leads/deps";
import { parseLead } from "@/lib/leads/parse";
import { createLead, leadDelivered } from "@/lib/leads/save";
import { readTurnstileToken } from "@/lib/turnstile";

// Single lead/contact endpoint. Every contact touchpoint on the site posts here
// and each is handled as its own "case" (distinct email subject, lib/leads/sources.ts).
// It (1) saves the lead to the inquiries table (super_admin reads it in the
// dashboard) and (2) emails the owner at info@gestaltung360.com. Both are
// best-effort — we succeed if either lands, so a missing email key never loses
// a lead. Flow: decode → Turnstile gate → validate (lib/leads/parse.ts) → createLead.

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", 400);
  }
  const token = readTurnstileToken(request.headers) ?? readTurnstileToken(body as Record<string, unknown> | null);
  if (!(await leadAllowed(request, token))) return jsonError("captcha_failed", 403);

  const parsed = parseLead(body);
  if (!parsed.ok) return jsonError(parsed.code, parsed.status);

  const result = await createLead(leadDeps(new URL(request.url).origin), parsed.lead);
  if (!leadDelivered(result)) return jsonError("not_delivered", 500);
  return jsonOk({ ok: true, ...result });
}
