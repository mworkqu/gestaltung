// Which catalogue page the next Voltaat batch should read — PURE, tested in
// voltaat-plan.test.ts. The run itself is lib/sourcing/voltaat-sync.ts.
//
// Why (2026-11-26). Voltaat's store lets through only a few of our requests a
// day, so reading page 1, 2, 3… in order and starting over every day spent
// those few requests on the same items again and again: pages 3 onward were
// never reached, and 289 mapped items had never been read at all.
//
// So each batch now asks: which ONE page is most worth a request right now?
//   * Every item has its own pace, from how often it changed in the last 60
//     days: 3+ changes -> daily, 1-2 -> every 3 days, none -> weekly.
//   * We remember which of our items each page held the last time we read it.
//   * A page's score is the number of its items that are due. A page we have
//     not read yet scores every due item we cannot place — so never-read
//     items come first.
//   * The best page is read. When nothing is due anywhere, NO request is made.
//
// The memory lives in store_settings["voltaat_sync_plan"] — no new table, no
// migration.

export const PLAN_STATE_KEY = "voltaat_sync_plan";
/** robots.txt is re-read this often (days); it is one of our few requests. */
export const ROBOTS_EVERY_DAYS = 7;
/** A page is never left unread longer than this (days), so items that moved between pages are found again. */
export const PAGE_MAX_AGE_DAYS = 7;
/** "Due" starts this many hours early, so a daily item is not pushed to every second day by the hour drifting. */
const DUE_SLACK_HOURS = 4;
/** An item we cannot place that was seen this recently has probably moved to another page (days). */
const LOST_RECENT_DAYS = 10;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export type PageInfo = {
  /** When this page was last read, and the time before that (ISO). */
  readAt: string;
  prevReadAt: string | null;
  /** Products Voltaat returned on it. */
  count: number;
  /** Our mapped offers that were on it. */
  offerIds: string[];
};

export type PlanState = {
  robotsOkAt: string | null;
  /** Page number -> what we found there last time. */
  pages: Record<string, PageInfo>;
  /** The page that came back short (the end of the catalogue), once known. */
  lastPage: number | null;
  /** When the owner was last sent the change report / a failure note. */
  reportedAt: string | null;
  failAlertedAt: string | null;
};

export const EMPTY_PLAN: PlanState = { robotsOkAt: null, pages: {}, lastPage: null, reportedAt: null, failAlertedAt: null };

const iso = (s: unknown): string | null => (typeof s === "string" && Number.isFinite(Date.parse(s)) ? s : null);

/** Whatever store_settings holds -> a state; anything missing or malformed is dropped, never trusted. */
export function parsePlanState(value: unknown): PlanState {
  const v = value as Partial<PlanState> | null | undefined;
  if (!v || typeof v !== "object") return { ...EMPTY_PLAN, pages: {} };
  const pages: Record<string, PageInfo> = {};
  for (const [k, raw] of Object.entries((v.pages ?? {}) as Record<string, Partial<PageInfo>>)) {
    const n = Number(k);
    const readAt = iso(raw?.readAt);
    if (!Number.isInteger(n) || n < 1 || !readAt) continue;
    pages[String(n)] = {
      readAt,
      prevReadAt: iso(raw.prevReadAt),
      count: typeof raw.count === "number" ? raw.count : 0,
      offerIds: Array.isArray(raw.offerIds) ? raw.offerIds.filter((x): x is string => typeof x === "string") : [],
    };
  }
  const lastPage = typeof v.lastPage === "number" && Number.isInteger(v.lastPage) && v.lastPage >= 1 ? v.lastPage : null;
  return { robotsOkAt: iso(v.robotsOkAt), pages, lastPage, reportedAt: iso(v.reportedAt), failAlertedAt: iso(v.failAlertedAt) };
}

/** How often an item is worth checking (days), from how many times it changed in the last 60 days. */
export function cadenceDays(changes60d: number): 1 | 3 | 7 {
  if (changes60d >= 3) return 1;
  if (changes60d >= 1) return 3;
  return 7;
}

export type PlanOffer = {
  id: string;
  hasHandle: boolean;
  /** When a batch last found it on a page; null = never read. */
  lastSeenAt: string | null;
  cadence: 1 | 3 | 7;
};

export function isDue(o: PlanOffer, now: Date): boolean {
  if (!o.hasHandle) return false;
  if (!o.lastSeenAt) return true;
  return now.getTime() - Date.parse(o.lastSeenAt) >= o.cadence * DAY - DUE_SLACK_HOURS * HOUR;
}

export type PlanStep =
  | { kind: "skip"; reason: "nothing_due" }
  | { kind: "robots" }
  /** `due` = how many due items this page is expected to hold; `known` = we have read it before. */
  | { kind: "page"; page: number; due: number; known: boolean };

/**
 * What this batch does: robots.txt when it is a week old, else the one page
 * with the most due items, else nothing. `force` ("Run now") reads the best
 * page even when nothing is due.
 */
export function chooseStep(state: PlanState, offers: readonly PlanOffer[], now: Date, force = false): PlanStep {
  if (!state.robotsOkAt || now.getTime() - Date.parse(state.robotsOkAt) >= ROBOTS_EVERY_DAYS * DAY) return { kind: "robots" };

  const byId = new Map(offers.map((o) => [o.id, o]));
  const placed = new Set<string>();
  const known = Object.keys(state.pages)
    .map(Number)
    .sort((a, b) => a - b);
  for (const p of known) for (const id of state.pages[String(p)].offerIds) placed.add(id);

  // Due items we cannot place on any page we know.
  const unplaced = offers.filter((o) => !placed.has(o.id) && isDue(o, now));
  // Of those, the ones seen recently have most likely just moved to another page.
  const lost = unplaced
    .filter((o) => o.lastSeenAt && now.getTime() - Date.parse(o.lastSeenAt) < LOST_RECENT_DAYS * DAY)
    .map((o) => Date.parse(o.lastSeenAt!));

  type Cand = { page: number; due: number; known: boolean; readAt: number };
  const cands: Cand[] = known.map((p) => {
    const info = state.pages[String(p)];
    const readAt = Date.parse(info.readAt);
    let due = 0;
    for (const id of info.offerIds) {
      const o = byId.get(id);
      if (o && isDue(o, now)) due++;
    }
    // An item that moved can only be on a page we have not read since we last
    // saw it; a page read after that did not have it.
    due += lost.filter((seenAt) => seenAt >= readAt).length;
    // Never leave a page unread for more than a week.
    if (now.getTime() - readAt >= PAGE_MAX_AGE_DAYS * DAY) due = Math.max(due, 1);
    return { page: p, due, known: true, readAt };
  });
  // The next page we have never read, while we do not know where the catalogue ends.
  if (state.lastPage === null) {
    const next = (known.length ? known[known.length - 1] : 0) + 1;
    cands.push({ page: next, due: unplaced.length, known: false, readAt: 0 });
  }

  cands.sort((a, b) => b.due - a.due || a.readAt - b.readAt || a.page - b.page);
  const best = cands[0];
  if (!best) return { kind: "skip", reason: "nothing_due" };
  if (best.due <= 0 && !force) return { kind: "skip", reason: "nothing_due" };
  return { kind: "page", page: best.page, due: best.due, known: best.known };
}

/** The state after a page was read. A short page is the end of the catalogue; pages past it are forgotten. */
export function afterPage(state: PlanState, page: number, count: number, seenOfferIds: readonly string[], pageSize: number, now: Date): PlanState {
  const pages = { ...state.pages };
  let lastPage = state.lastPage;
  if (count === 0 && page > 1) {
    // Past the end: the catalogue ends on the page before.
    delete pages[String(page)];
    lastPage = page - 1;
  } else {
    const before = pages[String(page)];
    pages[String(page)] = { readAt: now.toISOString(), prevReadAt: before?.readAt ?? null, count, offerIds: [...seenOfferIds] };
    if (count < pageSize) lastPage = page;
    else if (lastPage !== null && page >= lastPage) lastPage = null; // the catalogue grew past what was its last page
  }
  if (lastPage !== null) for (const k of Object.keys(pages)) if (Number(k) > lastPage) delete pages[k];
  return { ...state, pages, lastPage };
}

/**
 * Which mapped offers Voltaat no longer lists. Pages are read hours or days
 * apart and products shift between them, so one miss proves nothing. An offer
 * is "dropped" only when we know where the catalogue ends and EVERY page has
 * been read twice since the offer was last seen.
 */
export function droppedOffers<T extends { id: string; hasHandle: boolean; lastSeenAt: string | null }>(offers: readonly T[], state: PlanState): T[] {
  if (state.lastPage === null) return [];
  let oldestPrev = Infinity;
  for (let p = 1; p <= state.lastPage; p++) {
    const info = state.pages[String(p)];
    if (!info?.prevReadAt) return [];
    oldestPrev = Math.min(oldestPrev, Date.parse(info.prevReadAt));
  }
  return offers.filter((o) => o.hasHandle && (!o.lastSeenAt || Date.parse(o.lastSeenAt) < oldestPrev));
}
