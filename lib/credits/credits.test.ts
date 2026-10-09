import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { noFreeCircuit, type RawCanUse } from "./constants";
import { canUse, spend } from "./server";

// Owner rule (2026-10-09, migration 0052): the parts list is the only free AI
// step; every circuit costs 1 wiring credit, the first one on a project too.

const free = (balance: number): RawCanUse => ({ allowed: true, reason: null, cost: "free", role: "user", balance });

/** A Supabase client whose rpc() answers from a queue, recording each call. */
function fakeClient(answers: { data?: unknown; error?: { code?: string; message?: string } | null }[]) {
  const rpc = vi.fn(async () => {
    const a = answers.shift() ?? { data: null, error: { message: "no answer queued" } };
    return { data: a.data ?? null, error: a.error ?? null };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("noFreeCircuit", () => {
  it("turns a pre-0052 'free' first circuit into a paid one when the user has a credit", () => {
    expect(noFreeCircuit(free(2))).toEqual({ allowed: true, reason: null, cost: "credit", role: "user", balance: 2 });
  });

  it("blocks a pre-0052 'free' first circuit with no credits (the AccessNote path)", () => {
    expect(noFreeCircuit(free(0))).toEqual({
      allowed: false,
      reason: "no_credits",
      cost: "credit",
      role: "user",
      balance: 0,
    });
    expect(noFreeCircuit({ ...free(0), balance: undefined }).allowed).toBe(false);
  });

  it("leaves every other answer alone (bom, admin, credit, included, sign in)", () => {
    const answers: RawCanUse[] = [
      { allowed: true, reason: null, cost: "none", role: "anonymous" },
      { allowed: true, reason: null, cost: "none", role: "admin" },
      { allowed: true, reason: null, cost: "credit", role: "user", balance: 1 },
      { allowed: false, reason: "no_credits", cost: "credit", role: "user", balance: 0 },
      { allowed: true, reason: null, cost: "included", role: "user", balance: 0, regens: 2 },
      { allowed: false, reason: "sign_in", cost: null, role: "anonymous" },
    ];
    for (const a of answers) expect(noFreeCircuit(a)).toEqual(a);
  });
});

describe("canUse (server gate)", () => {
  it("never lets a first circuit through for free", async () => {
    const { client } = fakeClient([{ data: free(0) }]);
    const r = await canUse(client, "wiring", "p1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("no_credits");
  });

  it("still allows the parts list (bom) with 0 credits", async () => {
    const { client } = fakeClient([{ data: { allowed: true, reason: null, cost: "none", role: "user" } }]);
    const r = await canUse(client, "bom", "p1");
    expect(r).toMatchObject({ allowed: true, cost: "none" });
  });
});

describe("spend (server)", () => {
  it("charges the first circuit when the pre-0052 database marks it free", async () => {
    const { client, rpc } = fakeClient([
      { data: { charged: false, cost: "free", balance: 1 } },
      { data: { charged: true, cost: "credit", balance: 0 } },
    ]);
    const r = await spend(client, "wiring", "p1");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: true, charged: true, cost: "credit", balance: 0 });
  });

  it("calls spend_credit once after 0052 (already charged)", async () => {
    const { client, rpc } = fakeClient([{ data: { charged: true, cost: "credit", balance: 3 } }]);
    const r = await spend(client, "wiring", "p1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, charged: true });
  });

  it("does not retry CAD spends", async () => {
    const { client, rpc } = fakeClient([{ data: { charged: false, cost: "included", balance: 0 } }]);
    await spend(client, "cad", "p1");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("migration 0052", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0052_no_free_circuit.sql", import.meta.url), "utf8");
  const body = (fn: string) => {
    const start = sql.indexOf(`create or replace function public.${fn}(`);
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("end $$;", start));
  };

  it("credit_can_use has no free wiring branch", () => {
    const fn = body("credit_can_use");
    expect(fn).not.toContain("'free'");
    expect(fn).not.toContain("free_wiring_used");
  });

  it("spend_credit always writes a spend row for wiring and never answers 'free'", () => {
    const fn = body("spend_credit");
    expect(fn).not.toContain("'free'");
    expect(fn).toContain("'spend:' || p_project::text");
  });
});
