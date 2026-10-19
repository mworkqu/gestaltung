import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aiUsageByModel,
  buildCustomerExport,
  customerFileSlug,
  lastActiveAt,
  leadMatchesCustomer,
  totalPaidQar,
} from "./customer-export";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Err = { message: string; code?: string };
type Rows = Record<string, unknown>[];
type Fixture = Record<string, Rows | Err>;

/**
 * The slice of the Supabase query builder the export actually uses:
 * select / eq / in / order / limit / maybeSingle, awaited. A table absent from
 * the fixture behaves like one that does not exist (42P01), which is how a
 * not-yet-run migration looks to the real client.
 */
function fakeDb(fixture: Fixture): SupabaseClient {
  const from = (table: string) => {
    const entry = fixture[table];
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const result = (single: boolean) => {
      if (entry === undefined) return { data: null, error: { message: `relation "public.${table}" does not exist`, code: "42P01" } };
      if (!Array.isArray(entry)) return { data: null, error: entry };
      const rows = entry.filter((r) => filters.every((f) => f(r)));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return builder;
      },
      in: (col: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[col]));
        return builder;
      },
      maybeSingle: () => Promise.resolve(result(true)),
      then: <A, B>(ok: (v: unknown) => A, bad?: (e: unknown) => B) => Promise.resolve(result(false)).then(ok, bad),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function fakeService(user: Record<string, unknown> | null): SupabaseClient {
  return {
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
  } as unknown as SupabaseClient;
}

describe("leadMatchesCustomer", () => {
  const who = { email: "Ali@Example.com", phone: "+97466567410", projectIds: ["p1", "p2"] };

  it("matches a lead raised from one of their projects", () => {
    expect(leadMatchesCustomer({ project_id: "p2" }, who)).toBe(true);
    expect(leadMatchesCustomer({ project_id: "p9" }, who)).toBe(false);
  });

  it("matches the email regardless of case and spacing", () => {
    expect(leadMatchesCustomer({ email: " ali@example.com " }, who)).toBe(true);
    expect(leadMatchesCustomer({ email: "someone@example.com" }, who)).toBe(false);
  });

  it("matches a phone typed in any of the shapes the forms accept", () => {
    expect(leadMatchesCustomer({ phone: "66567410" }, who)).toBe(true);
    expect(leadMatchesCustomer({ phone: "+974 6656 7410" }, who)).toBe(true);
    expect(leadMatchesCustomer({ phone: "0097466567410" }, who)).toBe(true);
    expect(leadMatchesCustomer({ phone: "+97455512345" }, who)).toBe(false);
  });

  it("never matches on empty contact details", () => {
    expect(leadMatchesCustomer({ email: null, phone: null, project_id: null }, who)).toBe(false);
    expect(leadMatchesCustomer({ email: "", phone: "" }, { email: "", phone: "", projectIds: [] })).toBe(false);
  });
});

describe("totalPaidQar", () => {
  it("counts approved payments only", () => {
    expect(
      totalPaidQar({
        payments: [
          { amount_qar: 100, status: "approved" },
          { amount_qar: 50, status: "awaiting_proof" },
          { amount_qar: 20, status: "rejected" },
        ],
      })
    ).toBe(100);
  });

  it("counts every order that was not cancelled, and adds the two up", () => {
    expect(
      totalPaidQar({
        payments: [{ amount_qar: "25.5", status: "approved" }],
        orders: [
          { total_qar: "74.5", status: "delivered" },
          { total_qar: 300, status: "cancelled" },
        ],
      })
    ).toBe(100);
  });

  it("is 0 with nothing to count, and ignores junk amounts", () => {
    expect(totalPaidQar({})).toBe(0);
    expect(totalPaidQar({ payments: [{ amount_qar: "abc", status: "approved" }] })).toBe(0);
  });
});

describe("customerFileSlug", () => {
  it("keeps letters and digits only", () => {
    expect(customerFileSlug("ali@example.com")).toBe("ali-example-com");
    expect(customerFileSlug("  Ali  Al-Thani ")).toBe("Ali-Al-Thani");
  });

  it("falls back when there is nothing usable", () => {
    expect(customerFileSlug(null)).toBe("customer");
    expect(customerFileSlug("!!!")).toBe("customer");
  });

  it("caps at 40 characters without a trailing dash", () => {
    const slug = customerFileSlug(`${"a".repeat(39)}@example.com`);
    expect(slug).toBe("a".repeat(39));
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe("lastActiveAt", () => {
  it("returns the newest timestamp and ignores blanks", () => {
    expect(lastActiveAt([null, "2026-01-02T00:00:00Z", undefined, "2026-03-04T00:00:00Z"])).toBe("2026-03-04T00:00:00Z");
    expect(lastActiveAt([null, undefined])).toBeNull();
  });
});

describe("aiUsageByModel", () => {
  it("rolls calls up per model, newest call first, dearest model first", () => {
    const rows = aiUsageByModel([
      { model: "a", prompt_tokens: 10, completion_tokens: 5, cost_usd: 1, created_at: "2026-01-01T00:00:00Z" },
      { model: "a", prompt_tokens: 1, completion_tokens: 2, cost_usd: "0.5", created_at: "2026-02-01T00:00:00Z" },
      { model: "b", prompt_tokens: 100, completion_tokens: 0, cost_usd: 0.25, created_at: "2026-01-05T00:00:00Z" },
    ]);
    expect(rows.map((r) => r.model)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ calls: 2, promptTokens: 11, completionTokens: 7, costUsd: 1.5, unpriced: false });
    expect(rows[0].lastCallAt).toBe("2026-02-01T00:00:00Z");
  });

  it("skips blocked calls, which never reached a provider", () => {
    expect(aiUsageByModel([{ model: "a", outcome: "blocked", cost_usd: 9 }])).toEqual([]);
  });

  it("flags a model whose cost we cannot work out rather than calling it free", () => {
    const [row] = aiUsageByModel([{ model: "mystery-model-9000", prompt_tokens: 10, completion_tokens: 10 }]);
    expect(row).toMatchObject({ calls: 1, costUsd: 0, unpriced: true });
  });
});

describe("buildCustomerExport", () => {
  const fixture = (): Fixture => ({
    profiles: [
      { id: USER, role: "client", full_name: "Ali", phone: "66567410", email: "ali@example.com", locale: "ar", created_at: "2026-01-01T00:00:00Z" },
      { id: OTHER, role: "client", full_name: "Noor", phone: null, email: "noor@example.com", locale: "en", created_at: "2026-01-01T00:00:00Z" },
    ],
    projects: [
      { id: "p1", user_id: USER, name: "Lamp", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-09T00:00:00Z", notes: "key AIzaSyA1234567890123456789xyz left in a note" },
      { id: "p9", user_id: OTHER, name: "Not his", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-02T00:00:00Z" },
    ],
    part_orders: [
      { id: "o1", profile_id: USER, status: "delivered", total_qar: 300, created_at: "2026-03-01T00:00:00Z" },
      { id: "o2", profile_id: OTHER, status: "delivered", total_qar: 999, created_at: "2026-03-01T00:00:00Z" },
    ],
    part_order_items: [
      { id: "i1", order_id: "o1", part_name: "Relay", quantity: 2, unit_price_qar: 10 },
      { id: "i2", order_id: "o2", part_name: "Wire", quantity: 1, unit_price_qar: 5 },
    ],
    inquiries: [
      { id: "l1", project_id: "p1", name: "Ali", phone: "70000000", message: "from the project", created_at: "2026-02-05T00:00:00Z" },
      { id: "l2", project_id: null, email: "ALI@example.com", phone: null, message: "by email", created_at: "2026-02-06T00:00:00Z" },
      { id: "l3", project_id: null, email: "nobody@example.com", phone: "55500000", message: "someone else", created_at: "2026-02-07T00:00:00Z" },
    ],
    credits_ledger: [{ id: "c1", user_id: USER, kind: "idea", delta: -1, reason: "idea:p1", created_at: "2026-02-03T00:00:00Z" }],
    payments: [
      { id: "pay1", user_id: USER, status: "approved", amount_qar: 50, product: "tokens_100", created_at: "2026-02-04T00:00:00Z" },
      { id: "pay2", user_id: USER, status: "rejected", amount_qar: 400, product: "pass_30", created_at: "2026-02-04T00:00:00Z" },
    ],
    idea_passes: [{ user_id: USER, active_until: "2026-12-01T00:00:00Z" }],
    idea_sessions: [{ project_id: "p1", user_id: USER, edit_turns: 3, tier: "explorer", updated_at: "2026-02-08T00:00:00Z" }],
    ai_usage: [
      { id: "u1", user_id: USER, model: "a", prompt_tokens: 10, completion_tokens: 1, cost_usd: 0.5, outcome: "ok", created_at: "2026-02-07T00:00:00Z" },
      { id: "u2", user_id: OTHER, model: "a", prompt_tokens: 99, completion_tokens: 9, cost_usd: 9, outcome: "ok", created_at: "2026-02-07T00:00:00Z" },
    ],
    engineering_jobs: [{ id: "j1", user_id: USER, kind: "step_model", status: "queued", created_at: "2026-02-02T00:00:00Z" }],
    cad_generations: [{ id: "g1", user_id: USER, project_id: "p1", tier: "simple", status: "delivered", created_at: "2026-02-02T00:00:00Z" }],
    notification_outbox: [{ id: "n1", user_id: USER, kind: "order_confirmed", status: "sent", created_at: "2026-03-01T00:00:00Z" }],
    // demand_signals is left out on purpose: it stands in for a table we cannot read.
  });

  it("returns every section for the customer, and only their rows", async () => {
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service: null, exportedBy: "super_admin" }))!;
    expect(out).toBeTruthy();
    expect((out.customer as Record<string, unknown>).email).toBe("ali@example.com");
    expect((out.projects as Rows).map((p) => p.id)).toEqual(["p1"]);
    expect((out.payments as Rows).map((p) => p.id)).toEqual(["pay1", "pay2"]);
    expect((out.creditsLedger as Rows).length).toBe(1);
    expect((out.ideaSessions as Rows).length).toBe(1);
    expect((out.engineeringJobs as Rows).length).toBe(1);
    expect((out.cadGenerations as Rows).length).toBe(1);
    expect((out.notificationOutbox as Rows).length).toBe(1);
    expect((out.ideaPass as Record<string, unknown>).active_until).toBe("2026-12-01T00:00:00Z");
    expect((out.aiUsage as Rows).map((u) => u.id)).toEqual(["u1"]);
    expect(out.aiUsageByModel).toEqual([
      { model: "a", calls: 1, promptTokens: 10, completionTokens: 1, costUsd: 0.5, unpriced: false, lastCallAt: "2026-02-07T00:00:00Z" },
    ]);
    expect(out.exportVersion).toBe(1);
    expect(out.exportedBy).toBe("super_admin");
  });

  it("nests the order items under their order", async () => {
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service: null, exportedBy: "super_admin" }))!;
    const orders = out.orders as { id: string; items: Rows }[];
    expect(orders.map((o) => o.id)).toEqual(["o1"]);
    expect(orders[0].items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("keeps the leads that match by project, email or phone", async () => {
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service: null, exportedBy: "super_admin" }))!;
    expect((out.leads as Rows).map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("totals what the customer is worth", async () => {
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service: null, exportedBy: "super_admin" }))!;
    expect(out.totals).toMatchObject({
      projects: 1,
      orders: 1,
      orderItems: 1,
      leads: 2,
      aiCalls: 1,
      engineeringJobs: 1,
      cadGenerations: 1,
      // 50 QAR approved + the 300 QAR order; the rejected 400 is not money we have.
      totalPaidQar: 350,
    });
  });

  it("notes a table it could not read instead of failing", async () => {
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service: null, exportedBy: "super_admin" }))!;
    const notes = out._notes as string[];
    expect(out.demandSignals).toEqual([]);
    expect(notes.some((n) => n.startsWith("demand signals: not readable"))).toBe(true);
    expect(notes.some((n) => n.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
    expect(notes.some((n) => n.includes("cart_items"))).toBe(true);
  });

  it("adds the auth record when the service key is there", async () => {
    const service = fakeService({
      email: "ali@auth.example.com",
      created_at: "2025-12-01T00:00:00Z",
      last_sign_in_at: "2026-04-01T00:00:00Z",
      is_anonymous: false,
      app_metadata: { provider: "google" },
    });
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service, exportedBy: "super_admin" }))!;
    const customer = out.customer as Record<string, unknown>;
    expect(customer.email).toBe("ali@auth.example.com");
    expect(customer.auth).toMatchObject({ signedUpAt: "2025-12-01T00:00:00Z", lastSignInAt: "2026-04-01T00:00:00Z", provider: "google" });
    expect((out.totals as Record<string, unknown>).lastActiveAt).toBe("2026-04-01T00:00:00Z");
  });

  it("redacts anything shaped like an API key", async () => {
    const out = (await buildCustomerExport(fakeDb(fixture()), USER, { service: null, exportedBy: "super_admin" }))!;
    const notes = (out.projects as Rows)[0].notes as string;
    expect(notes).toContain("[REDACTED API KEY]");
    expect(notes).not.toContain("AIzaSy");
  });

  it("is null when there is no such customer", async () => {
    const missing = await buildCustomerExport(fakeDb(fixture()), "33333333-3333-4333-8333-333333333333", {
      service: null,
      exportedBy: "super_admin",
    });
    expect(missing).toBeNull();
  });
});
