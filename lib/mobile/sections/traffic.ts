// "Traffic" — who reaches the site, which pages they open, and what the server
// answered.
//
// WHERE THE DATA COMES FROM. GA4 is consent-gated and lives in Google's
// dashboard, so it can say nothing about a visitor who declined cookies and
// nothing at all to this app. Since the site is served by our own Node process
// on the Mac, that process writes one line per request instead
// (services/access-log.mjs): no IP, no query string, no account — a path, a
// status, how long it took, the country Cloudflare reported, the referrer's
// host, and a visitor key that is a hash of IP + user agent with a salt that
// changes every day. The salt rotation is the point: two visits on different
// days cannot be tied to the same person, so "visitors" is only ever a
// same-day count.
//
// Pure: parsed entries in, one Section out.

import {
  breakdown,
  daily,
  delta,
  int,
  lastDays,
  pct,
  tally,
  toneUp,
  type Section,
  type Table,
} from "@/lib/mobile/report";

/** One request, as a line of the access log. Short keys keep the file small. */
export type AccessEntry = {
  /** Unix ms. */
  t: number;
  /** Path only, no query string. */
  p: string;
  /** HTTP status. */
  s: number;
  /** Duration in ms. */
  d: number;
  /** Day-salted hash of IP + user agent. Empty when it could not be built. */
  v: string;
  /** 1 when the user agent looks like a crawler. */
  b: 0 | 1;
  /** Two-letter country from Cloudflare, or "" when absent. */
  c: string;
  /** Referrer host, or "" for a direct visit. */
  r: string;
};

export type TrafficInput = {
  entries: AccessEntry[];
  windowDays: number;
  /** Days the log actually covers, for an honest "since" note. */
  daysOnFile: number;
  now?: number;
};

/** A page view, not an asset or an API call — what a person actually opened. */
export function isPageView(entry: AccessEntry): boolean {
  if (entry.b) return false;
  const p = entry.p;
  if (p.startsWith("/_next/") || p.startsWith("/api/")) return false;
  if (/\.(?:png|jpe?g|webp|avif|svg|ico|css|js|map|woff2?|ttf|txt|xml|json|pdf)$/i.test(p)) return false;
  return true;
}

export function parseAccessLog(text: string): AccessEntry[] {
  const out: AccessEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const raw = JSON.parse(trimmed) as Partial<AccessEntry>;
      if (typeof raw.t !== "number" || typeof raw.p !== "string") continue;
      out.push({
        t: raw.t,
        p: raw.p,
        s: typeof raw.s === "number" ? raw.s : 0,
        d: typeof raw.d === "number" ? raw.d : 0,
        v: typeof raw.v === "string" ? raw.v : "",
        b: raw.b === 1 ? 1 : 0,
        c: typeof raw.c === "string" ? raw.c : "",
        r: typeof raw.r === "string" ? raw.r : "",
      });
    } catch {
      // A half-written last line is normal: the server appends as it serves.
    }
  }
  return out;
}

export function buildTraffic(input: TrafficInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;
  const from = now - days * 86_400_000;
  const half = now - (days / 2) * 86_400_000;

  const all = input.entries.filter((e) => e.t >= from);
  const views = all.filter(isPageView);
  const bots = all.filter((e) => e.b === 1);

  // Unique visitors can only be counted inside a day (the hash salt changes at
  // midnight), so the headline is the sum of per-day uniques.
  const perDay = new Map<string, Set<string>>();
  for (const e of views) {
    if (!e.v) continue;
    const key = new Date(e.t).toISOString().slice(0, 10);
    const set = perDay.get(key) ?? new Set<string>();
    set.add(e.v);
    perDay.set(key, set);
  }
  const visitorDays = [...perDay.values()].reduce((s, set) => s + set.size, 0);

  // Second half against first half of the window, so the delta means something
  // even on a log that only started a few days ago.
  const recentViews = views.filter((e) => e.t >= half).length;
  const earlierViews = views.filter((e) => e.t < half).length;

  const errors = all.filter((e) => e.s >= 500);
  const notFound = all.filter((e) => e.s === 404);
  const slow = views.filter((e) => e.d > 1000);

  const durations = views.map((e) => e.d).filter((d) => d > 0).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;

  // One visit = one visitor key on one day; the first page they opened is the
  // landing page, and a key with a single view bounced.
  const byVisitor = new Map<string, AccessEntry[]>();
  for (const e of views) {
    if (!e.v) continue;
    const key = `${new Date(e.t).toISOString().slice(0, 10)}|${e.v}`;
    const list = byVisitor.get(key) ?? [];
    list.push(e);
    byVisitor.set(key, list);
  }
  const visits = [...byVisitor.values()];
  const bounced = visits.filter((list) => list.length === 1).length;
  const landing = tally(
    visits.map((list) => [...list].sort((a, b) => a.t - b.t)[0]),
    (e) => e.p,
  ).slice(0, 12);
  const exits = tally(
    visits.map((list) => [...list].sort((a, b) => b.t - a.t)[0]),
    (e) => e.p,
  ).slice(0, 12);

  const tiles = [
    {
      label: "Page views",
      value: int(views.length),
      delta: delta(recentViews, earlierViews),
      tone: toneUp(recentViews, earlierViews),
      hint: `last ${Math.min(days, input.daysOnFile)} days on file`,
    },
    { label: "Visitors", value: int(visitorDays), hint: "counted fresh each day" },
    { label: "Visits", value: int(visits.length), hint: "one visitor, one day" },
    {
      label: "Pages a visit",
      value: visits.length ? (Math.round((views.length / visits.length) * 10) / 10).toFixed(1) : "—",
    },
    {
      label: "Left after one page",
      value: visits.length ? pct(bounced, visits.length) : "—",
      tone: visits.length && bounced / visits.length > 0.7 ? ("warn" as const) : ("flat" as const),
    },
    { label: "Crawlers", value: int(bots.length), hint: "requests, not people" },
    {
      label: "Server errors",
      value: int(errors.length),
      tone: errors.length ? ("bad" as const) : ("good" as const),
      hint: "status 500 and up",
    },
    {
      label: "Not found",
      value: int(notFound.length),
      tone: notFound.length > views.length * 0.05 ? ("warn" as const) : ("flat" as const),
      hint: "status 404",
    },
    {
      label: "Median page time",
      value: median === null ? "—" : `${median} ms`,
      hint: `${int(slow.length)} over a second`,
    },
  ];

  const tables: Table[] = [
    {
      title: "Most opened pages",
      columns: ["Route", "Views", "Visitors"],
      rows: tally(views, (e) => e.p)
        .slice(0, 20)
        .map(([path, n]) => [path, int(n), int(new Set(views.filter((e) => e.p === path).map((e) => e.v)).size)]),
      align: ["l", "r", "r"],
      empty: "Nothing in the log yet.",
    },
    {
      title: "Where they arrive",
      columns: ["Landing page", "Visits"],
      rows: landing.map(([path, n]) => [path, int(n)]),
      align: ["l", "r"],
      empty: "Nothing in the log yet.",
    },
    {
      title: "Where they leave",
      columns: ["Last page", "Visits"],
      rows: exits.map(([path, n]) => [path, int(n)]),
      align: ["l", "r"],
      empty: "Nothing in the log yet.",
    },
    {
      title: "Who sent them",
      columns: ["Referrer", "Views"],
      rows: tally(views, (e) => e.r || "direct")
        .slice(0, 12)
        .map(([host, n]) => [host, int(n)]),
      align: ["l", "r"],
      empty: "No referrers recorded.",
    },
    breakdown("Countries", tally(views, (e) => e.c || "unknown").slice(0, 12), ["Country", "Views"]),
    breakdown("Answers", tally(all, (e) => String(e.s)), ["Status", "Requests"]),
    {
      title: "Slowest routes",
      columns: ["Route", "Median ms", "Views"],
      rows: medianByRoute(views).slice(0, 12).map((r) => [r.path, int(r.median), int(r.count)]),
      align: ["l", "r", "r"],
      empty: "Nothing in the log yet.",
    },
    {
      title: "Broken links asked for",
      columns: ["Route", "Times"],
      rows: tally(notFound, (e) => e.p).slice(0, 12).map(([path, n]) => [path, int(n)]),
      align: ["l", "r"],
      empty: "No 404s.",
    },
  ];

  const notes = trafficNotes({
    requests: all.length,
    daysOnFile: input.daysOnFile,
    days,
    errors: errors.length,
    notFound: notFound.length,
    slow: slow.length,
    bots: bots.length,
    visits: visits.length,
    bounced,
  });

  return {
    key: "traffic",
    title: "Traffic",
    symbol: "chart.line.uptrend.xyaxis",
    blurb: "Who reaches the site, which pages they open, what the server answered.",
    tiles,
    series: [
      { title: "Page views a day", kind: "bar", points: daily(views.map((e) => ({ at: new Date(e.t).toISOString() })), days, now) },
      {
        title: "Visitors a day",
        kind: "line",
        points: lastDays(days, now).map((key) => ({ x: key, y: perDay.get(key)?.size ?? 0 })),
      },
      { title: "Errors a day", kind: "bar", points: daily(all.filter((e) => e.s >= 500).map((e) => ({ at: new Date(e.t).toISOString() })), days, now) },
    ],
    tables,
    notes,
  };
}

function medianByRoute(views: AccessEntry[]): { path: string; median: number; count: number }[] {
  const groups = new Map<string, number[]>();
  for (const e of views) {
    if (!e.d) continue;
    const list = groups.get(e.p) ?? [];
    list.push(e.d);
    groups.set(e.p, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([path, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return { path, median: Math.round(sorted[Math.floor(sorted.length / 2)]), count: list.length };
    })
    .sort((a, b) => b.median - a.median);
}

/** What stands out, in plain words. Split out to keep buildTraffic simple. */
function trafficNotes(n: {
  requests: number;
  daysOnFile: number;
  days: number;
  errors: number;
  notFound: number;
  slow: number;
  bots: number;
  visits: number;
  bounced: number;
}): string[] {
  if (!n.requests) return ["The access log is empty. It starts filling the moment the site serves its next request."];
  const notes: string[] = [];
  if (n.daysOnFile < n.days) notes.push(`The log covers ${n.daysOnFile} day${n.daysOnFile === 1 ? "" : "s"} so far, not the full ${n.days}.`);
  if (n.errors) notes.push(`${n.errors} request${n.errors === 1 ? "" : "s"} ended in a server error.`);
  if (n.notFound) notes.push(`${n.notFound} request${n.notFound === 1 ? "" : "s"} hit a page that does not exist.`);
  if (n.slow) notes.push(`${n.slow} page view${n.slow === 1 ? "" : "s"} took over a second to answer.`);
  if (n.bots > n.requests / 2) notes.push("More than half of all requests were crawlers, not people.");
  if (n.visits && n.bounced / n.visits > 0.7) notes.push(`${pct(n.bounced, n.visits)} of visits were a single page.`);
  if (!notes.length) notes.push("Traffic looks healthy: nothing failing, nothing slow.");
  return notes;
}
