// What to do when Voltaat blocks us (403/429) — PURE, tested in
// voltaat-block.test.ts. The run itself is lib/sourcing/voltaat-sync.ts.
//
// Why this exists (2026-11). The 429 is almost certainly Voltaat's store
// refusing a shared cloud IP address, not a complaint about our request count:
// one run a day, one request every 5 seconds, ≤41 requests, and it stops at
// the first 403/429 without retrying. A block that comes from the IP address
// does not clear when we slow down — it clears when the request comes from
// somewhere else (the Mac Mini's Qatar residential line) or when the store
// lifts it. So while blocked we must:
//   * wait out the Retry-After the store sent instead of trying again on the
//     next schedule, and
//   * not email the owner once per blocked run. One email, once the block has
//     lasted BLOCKED_DAYS_BEFORE_EMAIL days in a row.
//
// The state lives in `supplier_sync_runs` (status + error), so there is no new
// table, no migration and no second source of truth.

/** Days of blocked runs in a row before the owner gets ONE email. */
export const BLOCKED_DAYS_BEFORE_EMAIL = 3;
/** No Retry-After in the answer: hold off this long (hours). */
export const DEFAULT_BLOCK_HOURS = 24;
/** A `running` row younger than this means another runner is in the middle of it. */
export const CONCURRENT_RUN_WINDOW_MS = 3600_000;

/**
 * HTTP Retry-After ("120" seconds, or an HTTP date) as an ISO instant.
 * Anything unparseable, in the past, or further out than 7 days -> null.
 */
export function parseRetryAfter(header: string | null | undefined, now: Date = new Date()): string | null {
  const raw = (header ?? "").trim();
  if (!raw) return null;
  const MAX_MS = 7 * 86_400_000;
  let at: number;
  if (/^\d+$/.test(raw)) at = now.getTime() + Number(raw) * 1000;
  else {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return null;
    at = parsed;
  }
  if (at <= now.getTime() || at - now.getTime() > MAX_MS) return null;
  return new Date(at).toISOString();
}

/** `blocked_429 retry_after=2026-11-22T03:00:00.000Z` — what goes in supplier_sync_runs.error. */
export function blockErrorText(reason: string, retryAfter: string | null): string {
  return retryAfter ? `${reason} retry_after=${retryAfter}` : reason;
}

/** The instant a blocked run said we may try again, or null when it said nothing. */
export function retryAfterFrom(error: string | null | undefined): string | null {
  const m = /retry_after=(\S+)/.exec(error ?? "");
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * When the next run may start after a block: the store's Retry-After, else
 * DEFAULT_BLOCK_HOURS from when the blocked run started.
 */
export function blockedUntil(run: { started_at: string; error?: string | null }): string {
  const said = retryAfterFrom(run.error);
  if (said) return said;
  const started = Date.parse(run.started_at);
  const base = Number.isFinite(started) ? started : Date.now();
  return new Date(base + DEFAULT_BLOCK_HOURS * 3600_000).toISOString();
}

/**
 * How many days in a row end in a blocked run, counting the day of `now`
 * (pass the started_at of every blocked run in the recent past). A gap of a
 * whole day ends the streak, so a block that clears and comes back a week
 * later starts counting again — and emails again.
 */
export function blockedDayStreak(blockedStartedAt: readonly string[], now: Date = new Date()): number {
  const days = new Set<string>();
  for (const iso of blockedStartedAt) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) days.add(new Date(t).toISOString().slice(0, 10));
  }
  let streak = 0;
  for (let i = 0; ; i++) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    if (!days.has(day)) break;
    streak++;
  }
  return streak;
}

/** One email per streak: the day the block reaches BLOCKED_DAYS_BEFORE_EMAIL days. */
export function shouldEmailBlocked(streak: number): boolean {
  return streak === BLOCKED_DAYS_BEFORE_EMAIL;
}

export type RecentRun = { id?: string; status: string; started_at: string; error?: string | null };

export type SkipReason =
  | { skip: false }
  | { skip: true; reason: "already_running" }
  | { skip: true; reason: "already_ran_today" }
  | { skip: true; reason: "blocked_until"; until: string };

/**
 * Whether this runner may start, from the recent runs of BOTH runners (they
 * share `supplier_sync_runs`, so the guard covers Vercel and the Mac Mini):
 *   another runner is in the middle of a run   -> no
 *   a finished run inside `minHoursBetween`    -> no (one run a day)
 *   the last run was blocked and the wait is not over -> no
 */
export function runGuard(runs: readonly RecentRun[], now: Date = new Date(), minHoursBetween = 20): SkipReason {
  const sorted = [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  for (const r of sorted) {
    const started = Date.parse(r.started_at);
    if (!Number.isFinite(started)) continue;
    if (r.status === "running" && now.getTime() - started < CONCURRENT_RUN_WINDOW_MS) return { skip: true, reason: "already_running" };
  }
  const since = now.getTime() - minHoursBetween * 3600_000;
  if (sorted.some((r) => r.status === "ok" && Date.parse(r.started_at) >= since)) return { skip: true, reason: "already_ran_today" };
  const lastFinished = sorted.find((r) => r.status !== "running" && r.status !== "skipped");
  if (lastFinished?.status === "blocked") {
    const until = blockedUntil(lastFinished);
    if (Date.parse(until) > now.getTime()) return { skip: true, reason: "blocked_until", until };
  }
  return { skip: false };
}
