import { createClient } from "@/lib/supabase/server";
import { logUsage, quota } from "@/lib/ai/usage";
import { rateLimited, routeRate, transcribeLimiters } from "@/lib/prototyping/ai-route-guard";
import { MAX_AUDIO_BYTES, WHISPER_LANGUAGES, type TranscribeError } from "@/lib/prototyping/voice";
import { clientIp } from "@/lib/rate-limit";
import { readTurnstileToken } from "@/lib/turnstile";
import { checkTurnstile } from "@/lib/turnstile-server";
import { jsonError, jsonOk } from "@/lib/http";

// Voice note → text, for the brief editor only.
//
// Whisper on Groq's free tier (GROQ_API_KEY, server-only). The audio lives in
// memory for the length of this request and is never written anywhere — it is
// forwarded, transcribed and dropped. The text goes back to the editor; it is
// never sent on for analysis from here.
//
// Cancelling in the browser aborts this request, and the abort is passed on
// to Groq so it stops too.
//
// Metered (lib/ai): every call is logged to ai_usage with the audio length
// and Groq's x-ratelimit-remaining-* headers, and the daily guard stops calls
// at the configured share of the free allowance.
//
// Guests pass Turnstile while the store_settings switch is on (token in the
// x-turnstile-token header or the cf-turnstile-response form field), and every
// caller has a per-user (guests: also per-IP) rate limit (AI-09). Groq gets
// GROQ_TIMEOUT_MS, inside maxDuration (AI-14).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// large-v3 rather than turbo: noticeably better on Arabic, still free.
const MODEL = process.env.GROQ_WHISPER_MODEL?.trim() || "whisper-large-v3";
// Upstream budget for one transcription; leaves room for metering inside maxDuration.
const GROQ_TIMEOUT_MS = 45_000;

const fail = (error: TranscribeError, status: number) => Response.json({ error }, { status });

export async function POST(request: Request) {
  // Same gate as /api/analyse: only someone with a session (a guest's
  // anonymous session counts) may spend the free quota.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("failed", 401);

  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return fail("not_configured", 503);

  const form = await request.formData().catch(() => null);
  if (user.is_anonymous) {
    const token = readTurnstileToken(request.headers) ?? readTurnstileToken(form);
    if (!(await checkTurnstile(request, token)).ok) return jsonError("captcha_failed", 403);
  }
  const rate = routeRate(transcribeLimiters, {
    userId: user.id,
    anonymous: user.is_anonymous === true,
    ip: clientIp(request.headers),
  });
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return fail("empty", 400);
  if (audio.size > MAX_AUDIO_BYTES) return fail("too_large", 413);
  if (audio.type && !audio.type.startsWith("audio/") && !audio.type.startsWith("video/"))
    return fail("not_audio", 415);

  const lang = String(form?.get("language") ?? "");
  const projectRaw = String(form?.get("projectId") ?? "");
  const projectId = /^[0-9a-f-]{36}$/i.test(projectRaw) ? projectRaw : null;

  if ((await quota(supabase, "groq")).paused) {
    await logUsage(supabase, { userId: user.id, provider: "groq", model: MODEL, projectId, feature: "transcribe", outcome: "blocked", errorCode: "paused" });
    return fail("paused", 429);
  }
  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "voice-note.webm");
  upstream.append("model", MODEL);
  // verbose_json carries the audio duration, which is what Groq meters.
  upstream.append("response_format", "verbose_json");
  upstream.append("temperature", "0");
  if ((WHISPER_LANGUAGES as readonly string[]).includes(lang)) upstream.append("language", lang);

  const started = Date.now();
  const meter = (res: Response | null, outcome: "ok" | "error", errorCode: string | null, audioSeconds?: number) => {
    const h = (name: string) => {
      const v = res?.headers.get(name);
      return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
    };
    return logUsage(supabase, { userId: user.id,
      provider: "groq",
      model: MODEL,
      projectId,
      feature: "transcribe",
      audioSeconds: audioSeconds ?? null,
      latencyMs: Date.now() - started,
      outcome,
      errorCode,
      // Per Groq: remaining-requests counts per DAY, remaining-tokens per MINUTE.
      remainingRequests: h("x-ratelimit-remaining-requests"),
      remainingTokens: h("x-ratelimit-remaining-tokens"),
    });
  };
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: upstream,
      // The browser's cancel still stops Groq; so does our own time budget.
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(GROQ_TIMEOUT_MS)]),
    });
    if (res.status === 429) {
      await meter(res, "error", "rate_limited");
      return fail("rate_limited", 429);
    }
    if (!res.ok) {
      console.warn(`[transcribe] groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await meter(res, "error", `http_${res.status}`);
      return fail("failed", 502);
    }
    const data = (await res.json()) as { text?: unknown; duration?: unknown };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    const seconds = typeof data.duration === "number" ? Math.round(data.duration * 100) / 100 : undefined;
    await meter(res, "ok", null, seconds);
    if (!text) return fail("empty", 422);
    return jsonOk({ text });
  } catch (e) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    console.warn("[transcribe] request failed:", timedOut ? "timed out" : e);
    await meter(null, "error", timedOut ? "timeout" : "network");
    return fail("failed", 502);
  }
}
