import { createClient } from "@/lib/supabase/server";
import { logUsage, quota } from "@/lib/ai/usage";
import { BriefChatBody, briefChatLimiters, rateLimited, routeRate } from "@/lib/prototyping/ai-route-guard";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { ProviderError } from "@/lib/prototyping/providers/types";
import { clientIp } from "@/lib/rate-limit";
import { readTurnstileToken } from "@/lib/turnstile";
import { checkTurnstile } from "@/lib/turnstile-server";
import { jsonError } from "@/lib/http";

// "Help me describe it" chat on the brief (owner, 2026-09-29). The model asks
// one plain question at a time about what matters for building the product,
// and when it has enough, returns a short paragraph to add to the brief. It
// never writes the brief itself — the client presses "Add to my brief".
// Same gate as /api/analyse: a session (guests count), the daily guard, and
// metered as feature "analyse" (the ai_usage feature list has no "chat").
// Guests also pass Turnstile while the store_settings switch is on (token in
// the x-turnstile-token header or body.turnstileToken), and every caller has a
// per-user (guests: also per-IP) rate limit (AI-09). The body is zod-parsed
// with the same cuts as before (AI-10, lib/prototyping/ai-route-guard.ts).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    done: { type: "BOOLEAN" },
    addition: { type: "STRING" },
  },
  required: ["reply", "done"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const parsed = BriefChatBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { locale, brief, messages, projectId } = parsed.data;

  if (user.is_anonymous) {
    const token = readTurnstileToken(request.headers) ?? parsed.data.turnstileToken;
    if (!(await checkTurnstile(request, token)).ok) return jsonError("captcha_failed", 403);
  }
  const rate = routeRate(briefChatLimiters, {
    userId: user.id,
    anonymous: user.is_anonymous === true,
    ip: clientIp(request.headers),
  });
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  if (!geminiConfigured()) return jsonError("unavailable", 503);
  if ((await quota(supabase, "gemini")).paused) return jsonError("paused", 429);

  const asked = messages.filter((m) => m.role === "assistant").length;
  const system =
    "You help a customer in Qatar describe a product idea so it can be prototyped (parts, electronics, enclosure, cost). " +
    "Ask ONE short, friendly, plain-language question at a time — no jargon — about what matters for building it: " +
    "what it must do, where it is used (indoor/outdoor), how it is powered, rough size, how many units, budget or deadline, " +
    "and anything it must connect to or fit onto. Never ask what the brief or the answers already say. " +
    "Offer 2–4 short example answers in the question when that helps. " +
    `After enough is known, or by question ${Math.max(6, asked + 1)}, set done=true, thank them, and put in "addition" ` +
    "a short factual paragraph (3–6 sentences) of the NEW information from the answers, written as the customer would, " +
    "to append to their brief. Otherwise done=false and addition empty. " +
    `Always write in ${locale === "ar" ? "Arabic" : "English"}.`;
  const prompt =
    `Current brief:\n${brief || "(empty)"}\n\nConversation so far:\n` +
    (messages.length ? messages.map((m) => `${m.role === "user" ? "Customer" : "You"}: ${m.text}`).join("\n") : "(none — ask your first question)");

  try {
    const res = await callGemini({ system, prompt, schema: SCHEMA, temperature: 0.4, timeoutMs: 45_000 });
    const raw = (res.raw ?? {}) as { reply?: string; done?: boolean; addition?: string };
    await logUsage(supabase, { userId: user.id,
      provider: "gemini",
      model: res.model,
      projectId,
      feature: "analyse",
      promptTokens: res.usage?.input,
      completionTokens: res.usage?.output,
      totalTokens: res.usage?.total,
      latencyMs: res.latencyMs,
      outcome: "ok",
    });
    return Response.json({
      reply: String(raw.reply ?? "").slice(0, 1500),
      done: Boolean(raw.done),
      addition: raw.done ? String(raw.addition ?? "").slice(0, 2000) : "",
    });
  } catch (e) {
    const reason = e instanceof ProviderError ? e.reason : "unavailable";
    await logUsage(supabase, { userId: user.id, provider: "gemini", projectId, feature: "analyse", outcome: "error", errorCode: reason });
    return jsonError(reason === "paused" ? "paused" : "unavailable", 502);
  }
}
