// The Voltaat sync against an in-memory database: one request per batch, only
// for the page with due items, drops decided once every page was read twice,
// and ONE report email a day.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/lib/supabase/db";

const m = vi.hoisted(() => ({
  sendEmail: vi.fn<(mail: { subject: string }) => Promise<void>>(async () => undefined),
  robots: vi.fn(async () => "User-agent: *\nAllow: /\n"),
  page: vi.fn(),
  requests: 0,
}));

vi.mock("@/lib/email", () => ({ OWNER_EMAIL: "owner@example.test", sendEmail: m.sendEmail }));
vi.mock("@/lib/email/lead-email", () => ({ renderOwnerEmail: (x: unknown) => ({ html: JSON.stringify(x), text: "" }) }));
vi.mock("@/lib/email/brand-layout", () => ({ dataTable: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/sourcing/catalog-snapshot", () => ({ snapshotParts: vi.fn(async () => []) }));
vi.mock("@/lib/cache/catalog-tags", () => ({ diffPartSnapshots: (ids: string[]) => ({ skus: ids, listingChanged: false }) }));
vi.mock("@/lib/sourcing/adapters/voltaat", async (orig) => {
  const real = await orig<typeof import("@/lib/sourcing/adapters/voltaat")>();
  class VoltaatClient {
    requests = 0;
    async robots() {
      this.requests++;
      m.requests++;
      return m.robots();
    }
    async page(n: number) {
      this.requests++;
      m.requests++;
      return m.page(n);
    }
  }
  return { ...real, PAGE_SIZE: 2, VoltaatClient };
});

import { BlockedError, type VoltaatProduct } from "@/lib/sourcing/adapters/voltaat";
import { runVoltaatSync } from "@/lib/sourcing/voltaat-sync";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/** Just enough of the supabase-js query builder for this job. */
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row = {};
    let range: [number, number] | null = null;
    let lim: number | null = null;
    let order: { col: string; asc: boolean } | null = null;
    const run = () => {
      if (op === "insert") {
        const row = { id: `run-${++seq}`, started_at: new Date().toISOString(), changes: [], ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op === "upsert") {
        const i = rows.findIndex((r) => r.key === payload.key);
        if (i >= 0) rows[i] = { ...rows[i], ...payload };
        else rows.push({ ...payload });
        return { data: null, error: null };
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      if (order) hit = [...hit].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
      if (range) hit = hit.slice(range[0], range[1] + 1);
      if (lim !== null) hit = hit.slice(0, lim);
      return { data: hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (p: Row) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      upsert: (p: Row) => ((op = "upsert"), (payload = p), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      gt: (c: string, v: number) => (filters.push((r) => Number(r[c] ?? 0) > v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      not: (c: string) => (filters.push((r) => r[c] !== null && r[c] !== undefined), q),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), q),
      range: (a: number, b: number) => ((range = [a, b]), q),
      limit: (n: number) => ((lim = n), q),
      single: async () => ({ data: run().data?.[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok),
    };
    return q;
  };
  return { from } as unknown as DbClient;
}

const product = (handle: string, price: number, available = true): VoltaatProduct => ({
  handle,
  title: handle,
  variants: [{ id: 1, sku: null, title: "Default", price, available }],
});
const pageOf = (...ps: VoltaatProduct[]) => ({ products: new Map(ps.map((p) => [p.handle, p])), count: ps.length });

const OLD = "2026-11-01T00:00:00.000Z";
const offer = (id: string, handle: string, price: number): Row => ({
  id,
  part_id: `part-${id}`,
  supplier_id: "sup",
  supplier_sku: null,
  supplier_url: `https://www.voltaat.com/products/${handle}`,
  retail_price: price,
  availability: "in_stock",
  lead_time_days: 2,
  active: true,
  last_checked_at: OLD,
  created_at: OLD,
  part: { name: handle, unit_price: price },
});

function setup() {
  const tables: Record<string, Row[]> = {
    store_settings: [],
    supplier_sync_runs: [],
    suppliers: [{ id: "sup", code: "voltaat" }],
    supplier_offers: [offer("a", "alpha", 10), offer("b", "bravo", 20), offer("c", "charlie", 30), offer("d", "gone", 40)],
    parts: ["a", "b", "c", "d"].map((id) => ({ id: `part-${id}`, unit_price: 0 })),
  };
  return { tables, db: fakeDb(tables) };
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const offerById = (tables: Record<string, Row[]>, id: string) => tables.supplier_offers.find((o) => o.id === id)!;
const planState = (tables: Record<string, Row[]>) => tables.store_settings.find((r) => r.key === "voltaat_sync_plan")?.value as { pages: Record<string, { offerIds: string[] }>; lastPage: number | null };
const steps = (tables: Record<string, Row[]>) => tables.supplier_sync_runs.length;

describe("runVoltaatSync: one request per batch, only for what is due", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T21:23:00Z"));
    m.sendEmail.mockClear();
    m.requests = 0;
    m.page.mockReset();
    // Page size is 2 here: page 1 is full, page 2 is short and ends the catalogue.
    m.page.mockImplementation(async (n: number) => (n === 1 ? pageOf(product("alpha", 12), product("bravo", 20)) : pageOf(product("charlie", 30, false))));
  });

  it("reads robots once, then each page once, then stops asking", async () => {
    const { tables, db } = setup();

    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "ok", step: "robots", requests: 1 });

    // Ten minutes later: too soon, and no request is made.
    vi.advanceTimersByTime(10 * 60_000);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "skipped", error: "too_soon", requests: 0 });
    expect(m.requests).toBe(1);

    vi.advanceTimersByTime(HOUR);
    const b1 = await runVoltaatSync(db, "cron");
    expect(b1).toMatchObject({ status: "ok", step: "page_1", requests: 1, checked: 2, changed: 1, dropped: 0 });
    expect(offerById(tables, "a").retail_price).toBe(12);
    expect(offerById(tables, "c").last_checked_at).toBe(OLD); // not on page 1: untouched
    expect(planState(tables).pages["1"].offerIds.sort()).toEqual(["a", "b"]);

    // Next batch: NOT page 1 again — the page it has not read, where the unread items must be.
    vi.advanceTimersByTime(HOUR);
    const b2 = await runVoltaatSync(db, "cron");
    expect(b2).toMatchObject({ status: "ok", step: "page_2", checked: 1, changed: 1, dropped: 0 });
    expect(offerById(tables, "c")).toMatchObject({ availability: "unavailable", active: false });
    expect(planState(tables).lastPage).toBe(2);
    expect(offerById(tables, "d").active).toBe(true); // every page read once only: not "dropped" yet

    // Everything was just read: hour after hour, nothing is sent to Voltaat.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(HOUR);
      expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "skipped", error: "nothing_due", requests: 0 });
    }
    expect(m.requests).toBe(3);
    expect(steps(tables)).toBe(3);
    // One report for the day, not one per batch.
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("checks an item that keeps changing sooner than one that never does", async () => {
    const { tables, db } = setup();
    // "alpha" changed three times in the last weeks: daily pace. The rest: weekly.
    tables.supplier_sync_runs.push({
      id: "old-run",
      supplier_code: "voltaat",
      status: "ok",
      changed: 3,
      started_at: "2026-11-10T03:00:00.000Z",
      changes: [1, 2, 3].map((n) => ({ offerId: "a", newRetail: n })),
    });
    for (let i = 0; i < 3; i++) {
      await runVoltaatSync(db, "cron"); // robots, page 1, page 2
      vi.advanceTimersByTime(HOUR);
    }
    const before = m.requests;

    // A day later only page 1 (where alpha is) is worth a request.
    vi.advanceTimersByTime(DAY);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "ok", step: "page_1", due: 1 });
    vi.advanceTimersByTime(HOUR);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "skipped", error: "nothing_due" });
    expect(m.requests).toBe(before + 1);
  });

  it("drops a product only after every page was read twice without it", async () => {
    const { tables, db } = setup();
    for (let i = 0; i < 3; i++) {
      await runVoltaatSync(db, "cron");
      vi.advanceTimersByTime(HOUR);
    }
    expect(offerById(tables, "d").active).toBe(true);

    vi.advanceTimersByTime(7 * DAY); // the weekly items are due again
    let last = await runVoltaatSync(db, "cron");
    for (let i = 0; i < 3 && !(last.dropped ?? 0); i++) {
      vi.advanceTimersByTime(HOUR);
      last = await runVoltaatSync(db, "cron");
    }
    expect(last).toMatchObject({ status: "ok", dropped: 1 });
    expect(offerById(tables, "d")).toMatchObject({ active: false, availability: "unavailable" });
    expect(offerById(tables, "a").active).toBe(true);
  });

  it("a refusal remembers nothing as read and waits before asking again", async () => {
    const { tables, db } = setup();
    await runVoltaatSync(db, "cron"); // robots
    vi.advanceTimersByTime(HOUR);
    m.page.mockRejectedValueOnce(new BlockedError(429, new Date(Date.now() + 60_000).toISOString()));
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "blocked", step: "page_1", requests: 1 });
    expect(planState(tables).pages).toEqual({});
    expect(m.sendEmail).not.toHaveBeenCalled();

    // 30 minutes later is inside the 45-minute back-off: no request.
    vi.advanceTimersByTime(30 * 60_000);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "skipped", error: "blocked_until", requests: 0 });
    expect(m.requests).toBe(2);

    // The next hourly batch asks for the same page again.
    vi.advanceTimersByTime(30 * 60_000);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "ok", step: "page_1", checked: 2 });
  });
});
