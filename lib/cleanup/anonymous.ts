// Anonymous-user cleanup (P2-09, FINDINGS #7) — pure parts. The candidate
// rule and the delete live in SQL (0055 cleanup_anonymous_users, SECURITY
// DEFINER, service_role only); this file parses the switch and the result.

export const CLEANUP_KEY = "anonymous_cleanup";
/** The SQL function refuses less than this (greatest(p_days, 7)); the UI agrees. */
export const CLEANUP_MIN_DAYS = 7;
export const CLEANUP_DEFAULT_DAYS = 30;

export type CleanupSettings = { enabled: boolean; dryRun: boolean; days: number };

/** No row = what 0055 seeds: on, DRY RUN, 30 days. dry_run is true unless explicitly false. */
export const CLEANUP_DEFAULTS: CleanupSettings = { enabled: true, dryRun: true, days: CLEANUP_DEFAULT_DAYS };

export function clampDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return CLEANUP_DEFAULT_DAYS;
  return Math.min(3650, Math.max(CLEANUP_MIN_DAYS, Math.trunc(n)));
}

export function parseCleanupSettings(raw: unknown): CleanupSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...CLEANUP_DEFAULTS };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled !== false,
    // Fail safe: anything but an explicit false keeps it a dry run.
    dryRun: o.dry_run !== false,
    days: o.days === undefined ? CLEANUP_DEFAULT_DAYS : clampDays(o.days),
  };
}

/** The stored jsonb shape (snake_case, as seeded by 0055). */
export function cleanupSettingsValue(s: CleanupSettings): { enabled: boolean; dry_run: boolean; days: number } {
  return { enabled: s.enabled, dry_run: s.dryRun, days: clampDays(s.days) };
}

export type CleanupResult = { dryRun: boolean; days: number; candidates: number; deleted: number; sample: string[] };

/** The function's jsonb answer; null when it is not the expected shape. */
export function parseCleanupResult(raw: unknown): CleanupResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const candidates = num(o.candidates);
  const deleted = num(o.deleted);
  if (candidates === null || deleted === null || typeof o.dry_run !== "boolean") return null;
  return {
    dryRun: o.dry_run,
    days: num(o.days) ?? CLEANUP_DEFAULT_DAYS,
    candidates,
    deleted,
    sample: Array.isArray(o.sample) ? o.sample.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
  };
}

/** Email the owner only when something was actually deleted. */
export function shouldEmail(r: CleanupResult): boolean {
  return !r.dryRun && r.deleted > 0;
}

/** The one-line summary for the log and the owner email. */
export function summaryLine(r: CleanupResult): string {
  const who = (n: number) => `${n} guest account${n === 1 ? "" : "s"}`;
  return r.dryRun
    ? `Anonymous cleanup (dry run): ${who(r.candidates)} older than ${r.days} days own nothing; nothing deleted.`
    : `Anonymous cleanup: deleted ${who(r.deleted)} older than ${r.days} days that owned nothing (${r.candidates} found).`;
}
