// Request gates for the free AI helpers on the brief: /api/brief-chat (Gemini)
// and /api/transcribe (Whisper on Groq). Pure apart from the module-level
// limiters (AI-09, AI-10).
//
// Rate limits: in memory, per server instance (lib/rate-limit.ts), keyed by the
// verified user id, plus the caller's IP for anonymous sessions (a guest
// session is cheap to mint). The DB-backed bomRate() is NOT used here on
// purpose: it shares one daily counter with /api/analyse (guests 5 a day), so
// a single brief-chat conversation would use up a guest's analysis allowance.
// These limits are a brake on one caller hammering the shared free quota; the
// daily guard in lib/ai still caps the total.

import { z } from "zod";

import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { asLocale } from "@/lib/locale";

/** What the model sees — unchanged from the route's former manual slices. */
export const BRIEF_CHAT_LIMITS = { brief: 6000, messages: 16, text: 1500 } as const;

// Hard caps on what is parsed at all. Generous on purpose: the editor allows a
// longer brief (MAX_BRIEF_CHARS) and the client sends the whole thread, which
// is then cut to BRIEF_CHAT_LIMITS as before, so honest requests never fail.
const HARD = { brief: 20_000, messages: 64, text: 10_000, projectId: 64, locale: 16, token: 4096 } as const;

const UUID = /^[0-9a-f-]{36}$/i;

export const BriefChatBody = z
  .object({
    projectId: z.string().max(HARD.projectId).nullish(),
    locale: z.string().max(HARD.locale).nullish(),
    brief: z.string().max(HARD.brief).nullish(),
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(HARD.text) }))
      .max(HARD.messages)
      .nullish(),
    turnstileToken: z.string().max(HARD.token).nullish(),
  })
  .transform((b) => ({
    projectId: b.projectId && UUID.test(b.projectId) ? b.projectId : null,
    locale: asLocale(b.locale),
    brief: (b.brief ?? "").slice(0, BRIEF_CHAT_LIMITS.brief),
    messages: (b.messages ?? [])
      .slice(-BRIEF_CHAT_LIMITS.messages)
      .map((m) => ({ role: m.role, text: m.text.slice(0, BRIEF_CHAT_LIMITS.text) })),
    turnstileToken: b.turnstileToken ?? null,
  }));

export type BriefChatRequest = z.output<typeof BriefChatBody>;

export type RouteLimiters = { user: RateLimiter; ip: RateLimiter };

const TEN_MIN = 10 * 60 * 1000;

/** brief-chat: a whole conversation is ~6–8 turns; a shared campus IP must not trip the guest limit. */
export const briefChatLimiters: RouteLimiters = {
  user: createRateLimiter({ limit: 30, windowMs: TEN_MIN }),
  ip: createRateLimiter({ limit: 120, windowMs: TEN_MIN }),
};

/** transcribe: one call per voice note. */
export const transcribeLimiters: RouteLimiters = {
  user: createRateLimiter({ limit: 20, windowMs: TEN_MIN }),
  ip: createRateLimiter({ limit: 80, windowMs: TEN_MIN }),
};

/**
 * Counts one call for this caller: always per user id, and per IP too for an
 * anonymous session. Denied when either window is full.
 */
export function routeRate(
  limiters: RouteLimiters,
  caller: { userId: string; anonymous: boolean; ip: string },
  now = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const byUser = limiters.user.hit(`u:${caller.userId}`, now);
  const byIp = caller.anonymous ? limiters.ip.hit(`ip:${caller.ip}`, now) : { allowed: true, retryAfterSec: 0 };
  const allowed = byUser.allowed && byIp.allowed;
  return { allowed, retryAfterSec: allowed ? 0 : Math.max(byUser.retryAfterSec, byIp.retryAfterSec) };
}

/** The 429 both routes answer when routeRate() says no. */
export function rateLimited(retryAfterSec: number): Response {
  return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
}
