// A whole pass of the Voltaat sync against an in-memory database: one request
// per batch, the pass position in store_settings, drops decided over two
// passes, and ONE report email when the pass ends.
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
const offerById = (tables: Record<string, Row[]>, id: string) => tables.supplier_offers.find((o) => o.id === id)!;
const passState = (tables: Record<string, Row[]>) => tables.store_settings.find((r) => r.key === "voltaat_sync_pass")?.value as Row;

describe("runVoltaatSync: one request per batch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T21:23:00Z")); // 00:23 in Qatar
    m.sendEmail.mockClear();
    m.requests = 0;
    m.page.mockReset();
    // Page size is 2 here: page 1 is full, page 2 is short and ends the pass.
    m.page.mockImplementation(async (n: number) => (n === 1 ? pageOf(product("alpha", 12), product("bravo", 20)) : pageOf(product("charlie", 30, false))));
  });

  it("reads robots, then one page per batch, and reports once when the pass ends", async () => {
    const { tables, db } = setup();

    const b0 = await runVoltaatSync(db, "cron");
    expect(b0).toMatchObject({ status: "ok", step: "robots", requests: 1, passDone: false });
    expect(passState(tables)).toMatchObject({ nextPage: 1, done: false });

    // Ten minutes later: too soon, and no request is made.
    vi.advanceTimersByTime(10 * 60_000);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "skipped", error: "too_soon", requests: 0 });
    expect(m.requests).toBe(1);

    vi.advanceTimersByTime(HOUR);
    const b1 = await runVoltaatSync(db, "cron");
    expect(b1).toMatchObject({ status: "ok", step: "page_1", requests: 1, checked: 2, changed: 1, dropped: 0, passDone: false });
    expect(offerById(tables, "a").retail_price).toBe(12);
    expect(offerById(tables, "b").last_checked_at).not.toBe(OLD);
    expect(offerById(tables, "c").last_checked_at).toBe(OLD); // not on page 1: untouched
    expect(m.sendEmail).not.toHaveBeenCalled(); // no email per batch

    vi.advanceTimersByTime(HOUR);
    const b2 = await runVoltaatSync(db, "cron");
    expect(b2).toMatchObject({ status: "ok", step: "page_2", requests: 1, checked: 1, changed: 1, passDone: true });
    expect(offerById(tables, "c")).toMatchObject({ availability: "unavailable", active: false });
    // First pass on record: nothing is called "dropped" yet.
    expect(b2.dropped).toBe(0);
    expect(offerById(tables, "d").active).toBe(true);
    // One email for the whole pass, covering both batches' changes.
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    expect(m.sendEmail.mock.calls[0][0]).toMatchObject({ subject: "Voltaat prices: 2 change(s) today" });

    // The rest of the day: the schedule keeps calling, nothing is requested.
    vi.advanceTimersByTime(HOUR);
    expect(await runVoltaatSync(db, "cron")).toMatchObject({ status: "skipped", error: "already_ran_today", requests: 0 });
    expect(m.requests).toBe(3);
    expect(tables.supplier_sync_runs).toHaveLength(3);
  });

  it("drops a product only after two whole passes missed it", async () => {
    const { tables, db } = setup();
    for (let i = 0; i < 3; i++) {
      await runVoltaatSync(db, "cron");
      vi.advanceTimersByTime(HOUR);
    }
    expect(offerById(tables, "d").active).toBe(true);

    vi.advanceTimersByTime(24 * HOUR); // the next Qatar day
    let last = await runVoltaatSync(db, "cron");
    expect(last.step).toBe("robots");
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(HOUR);
      last = await runVoltaatSync(db, "cron");
    }
    expect(last).toMatchObject({ step: "page_2", passDone: true, dropped: 1 });
    expect(offerById(tables, "d")).toMatchObject({ active: false, availability: "unavailable" });
    expect(offerById(tables, "a").active).toBe(true);
  });

  it("a refusal keeps the pass on the same page and waits before asking again", async () => {
    const { tables, db } = setup();
    await runVoltaatSync(db, "cron"); // robots
    vi.advanceTimersByTime(HOUR);
    m.page.mockRejectedValueOnce(new BlockedError(429, new Date(Date.now() + 60_000).toISOString()));
    const blocked = await runVoltaatSync(db, "cron");
    expect(blocked).toMatchObject({ status: "blocked", step: "page_1", requests: 1 });
    expect(passState(tables)).toMatchObject({ nextPage: 1, done: false });
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
