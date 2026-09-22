// Free-tier allowances for every AI provider we call. Server-only config —
// the ONE place these numbers live. Components and routes read them from here.
//
// Each figure can be overridden by an env var without a code change, e.g.
// AI_LIMIT_GEMINI_REQUESTS=500. The guard stops calling a provider once
// today's use reaches AI_GUARD_THRESHOLD (default 0.8 = 80 %) of any limit,
// so nothing ever runs into a paid overage without the owner deciding.
//
// Sources (checked 2026-09-22 — re-check when a provider changes its tiers):
//   Gemini: Google does not publish the free Flash-Lite figures in its docs;
//     they are shown per project at https://aistudio.google.com/rate-limit.
//     500 requests/day is the published third-party figure for
//     gemini-3.5-flash-lite — confirm it on that page. The free tier has no
//     daily token cap (only per-minute), so tokensPerDay is null.
//     "RPD quotas reset at midnight Pacific time" — ai.google.dev rate limits.
//   Groq Whisper (whisper-large-v3): 2,000 requests/day and 28,800 audio
//     seconds/day on the free tier — console.groq.com/docs/rate-limits.
//     Resets on a rolling basis; midnight UTC is used as the day boundary.

export type ProviderId = "gemini" | "groq";

export type ProviderLimits = {
  label: string;
  requestsPerDay: number | null;
  tokensPerDay: number | null;
  audioSecondsPerDay: number | null;
  /** IANA time zone whose midnight starts the provider's day. */
  resetTimeZone: string;
};

const num = (name: string, fallback: number | null): number | null => {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function providerLimits(id: ProviderId): ProviderLimits {
  if (id === "gemini")
    return {
      label: "Google Gemini",
      requestsPerDay: num("AI_LIMIT_GEMINI_REQUESTS", 500),
      tokensPerDay: num("AI_LIMIT_GEMINI_TOKENS", null),
      audioSecondsPerDay: null,
      resetTimeZone: process.env.AI_RESET_TZ_GEMINI?.trim() || "America/Los_Angeles",
    };
  return {
    label: "Groq Whisper",
    requestsPerDay: num("AI_LIMIT_GROQ_REQUESTS", 2000),
    tokensPerDay: null,
    audioSecondsPerDay: num("AI_LIMIT_GROQ_AUDIO_SECONDS", 28800),
    resetTimeZone: process.env.AI_RESET_TZ_GROQ?.trim() || "UTC",
  };
}

export const PROVIDERS: ProviderId[] = ["gemini", "groq"];

/** Share of any daily limit at which calls stop. 0–1. */
export function guardThreshold(): number {
  const v = num("AI_GUARD_THRESHOLD", 0.8);
  return v === null ? 0.8 : Math.min(1, v);
}

/** The instant the provider's current day began, in UTC. */
export function dayStart(timeZone: string, now = new Date()): Date {
  // Wall-clock parts of `now` in the zone, then back off to its midnight.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const sinceMidnight =
    ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight);
}

/** When the provider's next day begins. 25 h past today's start always lands
 *  inside tomorrow, even across a daylight-saving change. */
export const nextReset = (timeZone: string, now = new Date()) =>
  dayStart(timeZone, new Date(dayStart(timeZone, now).getTime() + 25 * 3600 * 1000));
