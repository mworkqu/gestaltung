// The Voltaat sync as a slow pass — PURE, tested in voltaat-pass.test.ts. The
// run itself is lib/sourcing/voltaat-sync.ts.
//
// Why (2026-11-24). Voltaat's store answers 429 with `Retry-After: 60` to a
// second request that follows the first by a few seconds; the old run made 8
// requests 5 s apart, so it was refused at request 2. The whole catalogue is
// still only ~7 requests (250 products each), which is far fewer than asking
// per product, so the feed stays — but it is read ONE REQUEST PER BATCH, an
// hour apart:
//
//   batch 0        robots.txt (may we read the feed?)
//   batch 1..n     /products.json page 1..n, until a page comes back short
//
// One pass a day (Asia/Qatar date). A batch that is refused or fails leaves
// the pass where it was; the next batch asks for the same page again.
//
// The pass position lives in store_settings["voltaat_sync_pass"] — no new
// table, no migration.

export const PASS_STATE_KEY = "voltaat_sync_pass";
/** An unfinished pass older than this is abandoned and a new one starts. */
export const PASS_STALE_HOURS = 22;
/** Asia/Qatar is UTC+3 all year. */
const QATAR_OFFSET_MS = 3 * 3600_000;

export type PassState = {
  /** When this pass began (ISO). An offer checked at or after it was seen in this pass. */
  startedAt: string;
  /** 0 = the robots.txt batch, 1.. = the catalogue page the next batch reads. */
  nextPage: number;
  done: boolean;
  completedAt: string | null;
  /** Start of the last pass that read the whole catalogue before this one. */
  prevStartedAt: string | null;
  /** The owner was already emailed about a failure in this pass. */
  failAlerted: boolean;
};

/** "2026-11-24" in Asia/Qatar. */
export function qatarDay(d: Date): string {
  return new Date(d.getTime() + QATAR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whatever store_settings holds → a state, or null when it is missing or malformed. */
export function parsePassState(value: unknown): PassState | null {
  const v = value as Partial<PassState> | null | undefined;
  if (!v || typeof v !== "object") return null;
  if (typeof v.startedAt !== "string" || !Number.isFinite(Date.parse(v.startedAt))) return null;
  if (typeof v.nextPage !== "number" || !Number.isInteger(v.nextPage) || v.nextPage < 0) return null;
  const iso = (s: unknown) => (typeof s === "string" && Number.isFinite(Date.parse(s)) ? s : null);
  return {
    startedAt: v.startedAt,
    nextPage: v.nextPage,
    done: v.done === true,
    completedAt: iso(v.completedAt),
    prevStartedAt: iso(v.prevStartedAt),
    failAlerted: v.failAlerted === true,
  };
}

export type PassStep =
  | { kind: "skip"; reason: "already_ran_today" }
  /** `state` is the pass this batch belongs to (a new one, or the stored one). */
  | { kind: "robots"; state: PassState; fresh: boolean }
  | { kind: "page"; page: number; state: PassState; fresh: boolean };

function newPass(prev: PassState | null, now: Date): PassState {
  return {
    startedAt: now.toISOString(),
    nextPage: 0,
    done: false,
    completedAt: null,
    // Only a pass that read the whole catalogue counts as "the previous pass".
    prevStartedAt: prev ? (prev.done ? prev.startedAt : prev.prevStartedAt) : null,
    failAlerted: false,
  };
}

/**
 * What this batch does.
 *   no pass yet, or the last one is finished and belongs to an earlier Qatar day -> start a new pass
 *   finished today: the schedule skips; "Run now" (manual) starts another pass
 *   unfinished: carry on from its next page, unless it went stale -> start over
 */
export function nextStep(state: PassState | null, now: Date, trigger: "cron" | "manual"): PassStep {
  let s = state;
  let fresh = false;
  if (!s) {
    s = newPass(null, now);
    fresh = true;
  } else if (s.done) {
    if (trigger === "cron" && qatarDay(new Date(s.startedAt)) >= qatarDay(now)) return { kind: "skip", reason: "already_ran_today" };
    s = newPass(s, now);
    fresh = true;
  } else if (now.getTime() - Date.parse(s.startedAt) > PASS_STALE_HOURS * 3600_000) {
    s = newPass(s, now);
    fresh = true;
  }
  return s.nextPage === 0 ? { kind: "robots", state: s, fresh } : { kind: "page", page: s.nextPage, state: s, fresh };
}

/** The state after the robots batch allowed the feed. */
export function afterRobots(state: PassState): PassState {
  return { ...state, nextPage: 1 };
}

/** The state after a page was read: a short page ends the pass. */
export function afterPage(state: PassState, page: number, productsOnPage: number, pageSize: number, maxPages: number, now: Date): PassState {
  if (productsOnPage < pageSize || page >= maxPages) return { ...state, nextPage: page + 1, done: true, completedAt: now.toISOString() };
  return { ...state, nextPage: page + 1 };
}

/**
 * Which mapped offers Voltaat no longer lists, decided when a pass ends.
 * The pass takes hours, and a product added or removed in between shifts the
 * pages, so one pass can miss a product that is still there. An offer is
 * therefore "dropped" only when NEITHER this pass nor the previous whole pass
 * saw it — i.e. it was last checked before the previous pass began (or never).
 * With no previous pass on record, nothing is dropped.
 */
export function droppedAfterPass<T extends { id: string; last_checked_at: string | null; hasHandle: boolean }>(
  offers: readonly T[],
  state: Pick<PassState, "startedAt" | "prevStartedAt">
): T[] {
  if (!state.prevStartedAt) return [];
  const cutoff = Math.min(Date.parse(state.prevStartedAt), Date.parse(state.startedAt));
  return offers.filter((o) => {
    if (!o.hasHandle) return false;
    if (!o.last_checked_at) return true;
    const t = Date.parse(o.last_checked_at);
    return !Number.isFinite(t) || t < cutoff;
  });
}
