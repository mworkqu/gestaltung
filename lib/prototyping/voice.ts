// Voice input for the brief: the shared limits and names, used by both the
// browser (components/prototyping/dictation.tsx) and /api/transcribe.

/** Under Vercel's 4.5 MB request body limit. Minutes of speech as Opus. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** A voice note stops itself here, well inside MAX_AUDIO_BYTES. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** Speech languages the client can pick, as BCP-47 tags for the browser engine. */
export const SPEECH_LANGS = ["ar-QA", "en-US"] as const;
export type SpeechLang = (typeof SPEECH_LANGS)[number];

/** Whisper takes ISO-639-1. */
export const WHISPER_LANGUAGES = ["ar", "en"] as const;
export const whisperLang = (l: SpeechLang) => l.slice(0, 2);

export type TranscribeError =
  | "not_configured"
  | "rate_limited"
  | "paused"
  | "too_large"
  | "not_audio"
  | "empty"
  | "failed";

/** Appends dictated text to what is already there, with a sensible gap. */
export function appendText(existing: string, added: string): string {
  const a = added.trim();
  if (!a) return existing;
  if (!existing.trim()) return a;
  return /\s$/.test(existing) ? existing + a : `${existing} ${a}`;
}
