import { describe, expect, it } from "vitest";

import { daily, delta, lastDays, money, num, pct } from "@/lib/mobile/report";
import { buildCad } from "@/lib/mobile/sections/cad";
import { buildChampions } from "@/lib/mobile/sections/champions";
import { buildOrders, stageTimings } from "@/lib/mobile/sections/orders";
import { buildPeople } from "@/lib/mobile/sections/people";
import { buildSourcing, priceMoves } from "@/lib/mobile/sections/sourcing";
import { buildStore } from "@/lib/mobile/sections/store";
import { buildTraffic, isPageView, parseAccessLog } from "@/lib/mobile/sections/traffic";

// A fixed "now" so every window is deterministic. Mid-afternoon in Doha, so a
// day bucket cannot straddle midnight by accident.
const NOW = Date.parse("2026-11-23T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("report helpers", () => {
  it("formats money without inventing decimals", () => {
    expect(money(1250)).toBe("1,250");
    expect(money(1250.5)).toBe("1,250.50");
  });

  it("reads Postgres numerics that arrive as strings", () => {
    expect(num("12.50")).toBe(12.5);
    expect(num(null)).toBe(0);
    expect(num("not a number")).toBe(0);
  });

  it("has no delta to show when there is nothing to compare", () => {
    expect(delta(0, 0)).toBeUndefined();
    expect(delta(5, 0)).toBe("+5");
    expect(delta(10, 5)).toBe("+100%");
    expect(delta(5, 10)).toBe("-50%");
  });

  it("gives a percentage only when the whole is real", () => {
    expect(pct(1, 4)).toBe("25%");
    expect(pct(1, 0)).toBe("—");
  });

  it("zero-fills every day in the window", () => {
    const points = daily([{ at: ago(1) }, { at: ago(1) }, { at: ago(3) }], 5, NOW);
    expect(points).toHaveLength(5);
    expect(points.map((p) => p.y)).toEqual([0, 1, 0, 2, 0]);
    expect(points[4].x).toBe(lastDays(1, NOW)[0]);
  });

  it("sums a weight instead of counting when asked", () => {
    const points = daily([{ at: ago(0), weight: 10 }, { at: ago(0), weight: 5 }], 2, NOW);
    expect(points[1].y).toBe(15);
  });

  it("ignores rows outside the window and rows with no date", () => {
    const points = daily([{ at: ago(99) }, { at: null }, { at: "nonsense" }], 3, NOW);
    expect(points.every((p) => p.y === 0)).toBe(true);
  });
});

describe("store section", () => {
  const part = (over: Partial<Parameters<typeof buildStore>[0]["parts"][number]> = {}) => ({
    id: "p1",
    sku: "SKU1",
    name: "Servo",
    category: "motors",
    store_category: null,
    unit_price: 100,
    landed_cost_qar: 60,
    lead_time_class: "stock",
    stock_status: "in_stock",
    is_published: true,
    merged_into: null,
    is_test: null,
    in_own_stock: true,
    created_at: ago(2),
    ...over,
  });

  it("leaves merged duplicates and test products out of every figure", () => {
    const section = buildStore({
      parts: [part(), part({ id: "p2", merged_into: "p1" }), part({ id: "p3", is_test: true })],
      ownStock: [],
      orderItems: [],
      signals: [],
      windowDays: 30,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Published products")?.value).toBe("1");
  });

  it("warns when own stock is down to the last few", () => {
    const section = buildStore({
      parts: [part()],
      ownStock: [{ part_id: "p1", qty: 2 }],
      orderItems: [],
      signals: [],
      windowDays: 30,
      now: NOW,
    });
    const low = section.tiles.find((t) => t.label === "Low stock");
    expect(low?.value).toBe("1");
    expect(low?.tone).toBe("warn");
    expect(section.notes.some((n) => n.includes("down to"))).toBe(true);
  });

  it("ranks best sellers by units and by revenue separately", () => {
    const section = buildStore({
      parts: [part(), part({ id: "p2", name: "Resistor" })],
      ownStock: [],
      orderItems: [
        { order_id: "o1", part_id: "p2", part_sku: "SKU2", part_name: "Resistor", quantity: 100, line_total_qar: 50, created_at: ago(1) },
        { order_id: "o2", part_id: "p1", part_sku: "SKU1", part_name: "Servo", quantity: 2, line_total_qar: 200, created_at: ago(1) },
      ],
      windowDays: 30,
      signals: [],
      now: NOW,
    });
    const units = section.tables.find((t) => t.title === "Best sellers by units");
    const revenue = section.tables.find((t) => t.title === "Best sellers by revenue");
    expect(units?.rows[0][0]).toBe("Resistor");
    expect(revenue?.rows[0][0]).toBe("Servo");
  });

  it("counts a product that has never been in an order", () => {
    const section = buildStore({
      parts: [part(), part({ id: "p2" })],
      ownStock: [],
      orderItems: [{ order_id: "o1", part_id: "p1", part_sku: null, part_name: "Servo", quantity: 1, line_total_qar: 10, created_at: ago(1) }],
      signals: [],
      windowDays: 30,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Never ordered")?.value).toBe("1");
  });

  it("lists every product by category, drafts included", () => {
    const section = buildStore({
      parts: [
        part({ id: "p1", name: "Servo", category: "motors" }),
        part({ id: "p2", name: "Resistor", category: "passives" }),
        part({ id: "p3", name: "Draft part", category: "motors", is_published: false }),
      ],
      ownStock: [{ part_id: "p1", qty: 4 }],
      orderItems: [],
      signals: [],
      windowDays: 30,
      now: NOW,
    });
    const list = section.tables.find((t) => t.title === "Every product");
    expect(list?.columns).toEqual(["Product", "Category", "Price", "Cost", "Stock", "Status"]);
    // motors before passives, and inside motors "Draft part" before "Servo".
    expect(list?.rows.map((r) => r[0])).toEqual(["Draft part", "Servo", "Resistor"]);
    expect(list?.rows[1]).toEqual(["Servo", "motors", "100", "60", "4", "in stock"]);
    expect(list?.rows[0][5]).toBe("draft");
  });

  it("leaves merged and test products out of the list", () => {
    const section = buildStore({
      parts: [part({ id: "p1" }), part({ id: "p2", merged_into: "p1" }), part({ id: "p3", is_test: true })],
      ownStock: [],
      orderItems: [],
      signals: [],
      windowDays: 30,
      now: NOW,
    });
    expect(section.tables.find((t) => t.title === "Every product")?.rows).toHaveLength(1);
  });

  it("caps the list at a hundred and says how many are not shown", () => {
    const parts = Array.from({ length: 142 }, (_, i) =>
      part({ id: `p${i}`, name: `Part ${String(i).padStart(3, "0")}` }),
    );
    const section = buildStore({ parts, ownStock: [], orderItems: [], signals: [], windowDays: 30, now: NOW });
    expect(section.tables.find((t) => t.title === "Every product")?.rows).toHaveLength(100);
    expect(section.notes.some((n) => n.includes("first 100 of 142"))).toBe(true);
  });

  it("says so rather than showing a zero when a product has no price or stock", () => {
    const section = buildStore({
      parts: [part({ unit_price: null, landed_cost_qar: null, in_own_stock: false, store_category: null, category: null })],
      ownStock: [],
      orderItems: [],
      signals: [],
      windowDays: 30,
      now: NOW,
    });
    const row = section.tables.find((t) => t.title === "Every product")?.rows[0];
    expect(row?.slice(1, 5)).toEqual(["\u2014", "\u2014", "\u2014", "\u2014"]);
  });
});

describe("order stage timings", () => {
  it("gives the median hours between neighbouring steps, in chain order", () => {
    const timings = stageTimings([
      { order_id: "a", status: "confirmed", changed_at: "2026-11-01T00:00:00Z" },
      { order_id: "a", status: "paid", changed_at: "2026-11-01T02:00:00Z" },
      { order_id: "b", status: "confirmed", changed_at: "2026-11-02T00:00:00Z" },
      { order_id: "b", status: "paid", changed_at: "2026-11-02T04:00:00Z" },
      { order_id: "b", status: "delivered", changed_at: "2026-11-03T04:00:00Z" },
    ]);
    const first = timings.find((t) => t.step === "confirmed → paid");
    expect(first?.medianHours).toBe(3);
    expect(first?.count).toBe(2);
    expect(timings[0].step).toBe("confirmed → paid");
  });

  it("maps the pre-0053 status names onto the chain", () => {
    const timings = stageTimings([
      { order_id: "a", status: "pending", changed_at: "2026-11-01T00:00:00Z" },
      { order_id: "a", status: "processing", changed_at: "2026-11-01T01:00:00Z" },
    ]);
    expect(timings[0].step).toBe("confirmed → sourcing");
  });

  it("skips junk: no order, no date, clocks running backwards", () => {
    expect(
      stageTimings([
        { order_id: null, status: "paid", changed_at: "2026-11-01T00:00:00Z" },
        { order_id: "a", status: "paid", changed_at: null },
        { order_id: "b", status: "confirmed", changed_at: "2026-11-02T05:00:00Z" },
      ]),
    ).toEqual([]);
  });
});

describe("orders section", () => {
  const order = (over: Partial<Parameters<typeof buildOrders>[0]["orders"][number]> = {}) => ({
    id: "o1",
    customer_name: "Sara",
    total_qar: 300,
    discount_qar: 0,
    status: "delivered",
    payment_method: "cash",
    delivery_area: "Lusail",
    shipping_tier: null,
    class_id: null,
    created_at: ago(1),
    is_test: null,
    ...over,
  });

  it("keeps test orders out of revenue", () => {
    const section = buildOrders({
      orders: [order(), order({ id: "o2", total_qar: 9999, is_test: true })],
      events: [],
      payments: [],
      carts: [],
      windowDays: 30,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Revenue (QAR)")?.value).toBe("300");
  });

  it("flags an order that has been open too long", () => {
    const section = buildOrders({
      orders: [order({ status: "sourcing", created_at: ago(12) })],
      events: [],
      payments: [],
      carts: [],
      windowDays: 30,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Still open")?.tone).toBe("warn");
    expect(section.notes.some((n) => n.includes("12 days"))).toBe(true);
  });

  it("leaves cancelled orders out of the average order value", () => {
    const section = buildOrders({
      orders: [order(), order({ id: "o2", status: "cancelled", total_qar: 1000 })],
      events: [],
      payments: [],
      carts: [],
      windowDays: 30,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Average order (QAR)")?.value).toBe("300");
  });
});

describe("price moves", () => {
  it("flattens the changes each sync run stored", () => {
    const moves = priceMoves([
      {
        supplier_code: "voltaat",
        trigger: "cron",
        status: "ok",
        started_at: ago(1),
        finished_at: ago(1),
        requests: 1,
        checked: 2,
        changed: 2,
        missing: 0,
        error: null,
        changes: [
          { partName: "Servo", oldRetail: 100, newRetail: 120, oldOurPrice: 150, newOurPrice: 180 },
          { partName: "Wire", oldRetail: 20, newRetail: 10 },
        ],
      },
    ]);
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ product: "Servo", oldRetail: 100, newRetail: 120, supplier: "voltaat" });
  });

  it("survives a run with no changes column, junk in it, or no date", () => {
    const base = {
      supplier_code: "v",
      trigger: null,
      status: "ok",
      finished_at: null,
      requests: null,
      checked: null,
      changed: null,
      missing: null,
      error: null,
    };
    expect(priceMoves([{ ...base, started_at: ago(1), changes: null }])).toEqual([]);
    expect(priceMoves([{ ...base, started_at: ago(1), changes: "oops" }])).toEqual([]);
    expect(priceMoves([{ ...base, started_at: null, changes: [{ partName: "x" }] }])).toEqual([]);
  });
});

describe("access log", () => {
  it("skips a half-written last line instead of throwing", () => {
    const entries = parseAccessLog('{"t":1,"p":"/en","s":200,"d":5,"v":"a","b":0,"c":"QA","r":""}\n{"t":2,"p":"/en/sto');
    expect(entries).toHaveLength(1);
    expect(entries[0].p).toBe("/en");
  });

  it("knows a page a person opened from an asset, an API call and a crawler", () => {
    const entry = (over: Partial<Parameters<typeof isPageView>[0]>) => ({ t: 1, p: "/en", s: 200, d: 1, v: "a", b: 0 as 0 | 1, c: "", r: "", ...over });
    expect(isPageView(entry({ p: "/en/store" }))).toBe(true);
    expect(isPageView(entry({ p: "/_next/static/chunk.js" }))).toBe(false);
    expect(isPageView(entry({ p: "/api/mobile/report" }))).toBe(false);
    expect(isPageView(entry({ p: "/logo.svg" }))).toBe(false);
    expect(isPageView(entry({ b: 1 }))).toBe(false);
  });

  it("counts visits per visitor-day and spots a one-page visit", () => {
    const day = Date.parse("2026-11-23T08:00:00Z");
    const section = buildTraffic({
      entries: [
        { t: day, p: "/en", s: 200, d: 100, v: "aaa", b: 0, c: "QA", r: "google.com" },
        { t: day + 1000, p: "/en/store", s: 200, d: 120, v: "aaa", b: 0, c: "QA", r: "" },
        { t: day + 2000, p: "/en", s: 200, d: 90, v: "bbb", b: 0, c: "DE", r: "" },
      ],
      windowDays: 30,
      daysOnFile: 1,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Page views")?.value).toBe("3");
    expect(section.tiles.find((t) => t.label === "Visitors")?.value).toBe("2");
    expect(section.tiles.find((t) => t.label === "Visits")?.value).toBe("2");
    expect(section.tiles.find((t) => t.label === "Left after one page")?.value).toBe("50%");
    expect(section.tables.find((t) => t.title === "Who sent them")?.rows[0]).toEqual(["direct", "2"]);
  });

  it("says so plainly when the log is empty", () => {
    const section = buildTraffic({ entries: [], windowDays: 30, daysOnFile: 0, now: NOW });
    expect(section.notes[0]).toContain("empty");
  });

  it("is honest about covering fewer days than the window", () => {
    const section = buildTraffic({
      entries: [{ t: NOW - 1000, p: "/en", s: 200, d: 10, v: "a", b: 0, c: "", r: "" }],
      windowDays: 30,
      daysOnFile: 2,
      now: NOW,
    });
    expect(section.notes.some((n) => n.includes("2 days"))).toBe(true);
  });

  it("counts a server error and a 404 apart from a good answer", () => {
    const section = buildTraffic({
      entries: [
        { t: NOW - 1000, p: "/en", s: 500, d: 10, v: "a", b: 0, c: "", r: "" },
        { t: NOW - 2000, p: "/nope", s: 404, d: 10, v: "a", b: 0, c: "", r: "" },
      ],
      windowDays: 30,
      daysOnFile: 1,
      now: NOW,
    });
    expect(section.tiles.find((t) => t.label === "Server errors")?.value).toBe("1");
    expect(section.tiles.find((t) => t.label === "Not found")?.value).toBe("1");
    expect(section.tables.find((t) => t.title === "Broken links asked for")?.rows[0]).toEqual(["/nope", "1"]);
  });
});

describe("every section", () => {
  // The dashboard must read as "nothing to do here", never as a blank screen,
  // on a database with nothing in it.
  const empty = { windowDays: 30, now: NOW };
  const sections = [
    buildStore({ parts: [], ownStock: [], orderItems: [], signals: [], ...empty }),
    buildSourcing({ suppliers: [], offers: [], runs: [], gaps: [], ...empty }),
    buildOrders({ orders: [], events: [], payments: [], carts: [], ...empty }),
    buildPeople({ profiles: [], inquiries: [], reviews: [], deletions: [], buyerKeys: [], ...empty }),
    buildChampions({
      students: [],
      enrollments: [],
      payments: [],
      attempts: [],
      progress: [],
      xp: [],
      plans: [],
      cohorts: [],
      flags: [],
      certificates: [],
      ...empty,
    }),
    buildCad({ cad: [], analyses: [], usage: [], credits: [], ...empty }),
    buildTraffic({ entries: [], daysOnFile: 0, ...empty }),
  ];

  it("says something rather than nothing when there is no data", () => {
    for (const section of sections) expect(section.notes.length).toBeGreaterThan(0);
  });

  it("gives every tile a value and every table an empty line", () => {
    for (const section of sections) {
      expect(section.tiles.length).toBeGreaterThan(0);
      for (const tile of section.tiles) expect(tile.value).not.toBe("");
      for (const table of section.tables) {
        if (!table.rows.length) expect(table.empty ?? "").not.toBe("");
      }
    }
  });

  it("has a unique key and an icon per section", () => {
    const keys = sections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const section of sections) expect(section.symbol).not.toBe("");
  });

  it("charts every day of the window, even an empty one", () => {
    for (const section of sections) {
      for (const series of section.series) expect(series.points).toHaveLength(30);
    }
  });
});
