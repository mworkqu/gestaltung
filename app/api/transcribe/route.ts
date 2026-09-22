import { createClient } from "@/lib/supabase/server";
import { MAX_AUDIO_BYTES, WHISPER_LANGUAGES, type TranscribeError } from "@/lib/prototyping/voice";

// Voice note → text, for the brief editor only.
//
// Whisper on Groq's free tier (GROQ_API_KEY, server-only). The audio lives in
// memory for the length of this request and is never written anywhere — it is
// forwarded, transcribed and dropped. The text goes back to the editor; it is
// never sent on for analysis from here.
//
// Cancelling in the browser aborts this request, and the abort is passed on
// to Groq so it stops too.

export const dynamic = "force-dynamic";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// large-v3 rather than turbo: noticeably better on Arabic, still free.
const MODEL = process.env.GROQ_WHISPER_MODEL?.trim() || "whisper-large-v3";

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
  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return fail("empty", 400);
  if (audio.size > MAX_AUDIO_BYTES) return fail("too_large", 413);
  if (audio.type && !audio.type.startsWith("audio/") && !audio.type.startsWith("video/"))
    return fail("not_audio", 415);

  const lang = String(form?.get("language") ?? "");
  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "voice-note.webm");
  upstream.append("model", MODEL);
  upstream.append("response_format", "json");
  upstream.append("temperature", "0");
  if ((WHISPER_LANGUAGES as readonly string[]).includes(lang)) upstream.append("language", lang);

  const started = Date.now();
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: upstream,
      signal: request.signal,
    });
    if (res.status === 429) return fail("rate_limited", 429);
    if (!res.ok) {
      console.warn(`[transcribe] groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return fail("failed", 502);
    }
    const data = (await res.json()) as { text?: unknown };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    // Server console only, so the owner can watch usage against the free tier.
    console.info(
      `[transcribe] groq (${MODEL}) ${Math.round(audio.size / 1024)} KB, lang=${lang || "auto"}, ${
        Date.now() - started
      } ms`
    );
    if (!text) return fail("empty", 422);
    return Response.json({ text });
  } catch (e) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.warn("[transcribe] request failed:", e);
    return fail("failed", 502);
  }
}
