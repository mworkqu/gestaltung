// CAD Champions per-user rate limits (Prompt 12 Step A). Reuses the site's
// in-memory fixed-window limiter (lib/rate-limit.ts): per server instance, so
// on Vercel it is a brake on one account hammering an action, not a global
// quota. A shared store would be needed for exact limits (see
// docs/cad-champions/SECURITY_REVIEW.md, finding on rate limits).
//
// Keys are the signed-in user's id, so one student cannot use up another's
// budget. Callers return their action's existing generic error (or an existing
// "too many" code) when `ccRateLimited` is true, so no new UI strings are
// needed; the event is logged without personal data.

import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const MIN = 60_000;

/** limit = hits allowed per window, per user. */
export const CC_RATE_LIMITS = {
  /** Coupon checks at checkout (stops code guessing). */
  coupon: { limit: 10, windowMs: 10 * MIN },
  /** Creating a payment reservation (SkipCash API + audit rows per call). */
  checkout: { limit: 10, windowMs: 10 * MIN },
  /** Fawran proof submissions. */
  proof: { limit: 6, windowMs: 60 * MIN },
  /** STEP grader calls from training exercises and the Get Ready practice upload. */
  grade: { limit: 20, windowMs: 10 * MIN },
  /** Lesson questions and grade queries (staff inbox). */
  question: { limit: 10, windowMs: 60 * MIN },
  /** Recording / checking test uploads (signed reads of storage per call). */
  upload: { limit: 60, windowMs: 10 * MIN },
  /** Staff AI translation of review comments (paid API). */
  translate: { limit: 30, windowMs: 10 * MIN },
  /** Cheap student actions with a server-side cost: start a test, signed task
   *  downloads, hint reveals, reservation cancel, account-deletion requests. */
  action: { limit: 60, windowMs: 10 * MIN },
  /** Payment status polling (may call the SkipCash API): a poll every ~3 s for 10 min fits. */
  poll: { limit: 240, windowMs: 10 * MIN },
} as const;

export type CcRateBucket = keyof typeof CC_RATE_LIMITS;

const limiters = new Map<CcRateBucket, RateLimiter>();

function limiterFor(bucket: CcRateBucket): RateLimiter {
  let l = limiters.get(bucket);
  if (!l) {
    l = createRateLimiter(CC_RATE_LIMITS[bucket]);
    limiters.set(bucket, l);
  }
  return l;
}

/** Counts one hit; true when this user is over the bucket's limit. */
export function ccRateLimited(bucket: CcRateBucket, userId: string, now?: number): boolean {
  const { allowed } = limiterFor(bucket).hit(`${bucket}:${userId}`, now);
  if (!allowed) console.warn(`[cc-rate-limit] ${bucket} limit reached`);
  return !allowed;
}
