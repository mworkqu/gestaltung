// What to do when Voltaat blocks us (403/429) — PURE, tested in
// voltaat-block.test.ts. The run itself is lib/sourcing/voltaat-sync.ts.
//
// What the block is (measured 2026-11-24 from the Mac's Qatar line): the store
// answers 429 with `Retry-After: 60` to a second request that follows the
// first by a few seconds. It is a short rate limit, not a ban. So the sync now
// makes one request per hourly batch (lib/sourcing/voltaat-pass.ts), and here:
//   * a blocked batch is waited out — the store's Retry-After, and never less
//     than a back-off that grows with every blocked batch in a row;
//   * two batches are never closer than MIN_MINUTES_BETWEEN_BATCHES;
//   * the owner is not emailed once per blocked batch. One email, once the
//     block has lasted BLOCKED_DAYS_BEFORE_EMAIL days in a row.
//
// The state lives in `supplier_sync_runs` (status + error), so there is no new
// table, no migration and no second source of truth.

/** Days of blocked runs in a row before the owner gets ONE email. */
export const BLOCKED_DAYS_BEFORE_EMAIL = 3;
/**
 * How long to stay away after a block, by how many batches in a row were
 * blocked (minutes): the next hourly batch, then skip one, then 3 h, 6 h,
 * 12 h, and a whole day from the sixth on. The store's own Retry-After wins
 * when it asks for longer. (2026-11-24: Voltaat sends `Retry-After: 60`, so a
 * single refusal costs one batch, not a day.)
 */
export const BLOCK_BACKOFF_MINUTES = [45, 90, 180, 360, 720, 1440] as const;
/** Two batches are never closer than this (minutes), whoever starts them. */
export const MIN_MINUTES_BETWEEN_BATCHES = 40;
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

/** Minutes to stay away after the `streak`-th blocked batch in a row (1 = the first). */
export function blockBackoffMinutes(streak: number): number {
  const i = Math.min(Math.max(1, Math.floor(streak)), BLOCK_BACKOFF_MINUTES.length) - 1;
  return BLOCK_BACKOFF_MINUTES[i];
}

/**
 * When the next batch may start after a block: the back-off for this many
 * blocked batches in a row, or the store's Retry-After when that is later.
 */
export function blockedUntil(run: { started_at: string; error?: string | null }, streak = 1): string {
  const started = Date.parse(run.started_at);
  const base = Number.isFinite(started) ? started : Date.now();
  const ours = base + blockBackoffMinutes(streak) * 60_000;
  const said = retryAfterFrom(run.error);
  return new Date(Math.max(ours, said ? Date.parse(said) : 0)).toISOString();
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
  | { skip: true; reason: "too_soon" }
  | { skip: true; reason: "blocked_until"; until: string };

/**
 * Whether a batch may start, from the recent runs of EVERY runner (they share
 * `supplier_sync_runs`, so the guard covers Vercel, the worker and launchd):
 *   another runner is in the middle of a batch          -> no
 *   a batch finished less than `minMinutesBetween` ago  -> no
 *   the last batch was blocked and the wait is not over -> no (the wait grows
 *   with every blocked batch in a row)
 */
export function runGuard(runs: readonly RecentRun[], now: Date = new Date(), minMinutesBetween = MIN_MINUTES_BETWEEN_BATCHES): SkipReason {
  const sorted = [...runs]
    .filter((r) => Number.isFinite(Date.parse(r.started_at)))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  for (const r of sorted) {
    if (r.status === "running" && now.getTime() - Date.parse(r.started_at) < CONCURRENT_RUN_WINDOW_MS) return { skip: true, reason: "already_running" };
  }
  const finished = sorted.filter((r) => r.status === "ok" || r.status === "blocked" || r.status === "failed");
  if (finished[0]?.status === "blocked") {
    let streak = 0;
    for (const r of finished) {
      if (r.status !== "blocked") break;
      streak++;
    }
    const until = blockedUntil(finished[0], streak);
    if (Date.parse(until) > now.getTime()) return { skip: true, reason: "blocked_until", until };
  }
  const since = now.getTime() - minMinutesBetween * 60_000;
  if (finished.some((r) => r.status !== "blocked" && Date.parse(r.started_at) >= since)) return { skip: true, reason: "too_soon" };
  return { skip: false };
}
