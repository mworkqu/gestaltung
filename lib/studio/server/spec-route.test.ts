// /api/studio/spec, the money side (owner, 2026-10-25): refining the same idea is
// free, a tier escalation and a switch to a different product pause for approval
// with the exact cost, approval charges exactly that, and a replayed approval
// charges nothing. Mocked Supabase + Gemini; no network, no database.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { clampSpec, type ProductSpec } from "@/lib/studio/schema";
import { ideaKey } from "@/lib/studio/identity";
import { fakeSupabase, type FakeDb } from "./fake-supabase";

type Fake = ReturnType<typeof fakeSupabase>;
const state: { main: Fake; answers: unknown[]; claimed: Set<string> } = {
  main: fakeSupabase({}),
  answers: [],
  claimed: new Set(),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.main.client }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null }));
vi.mock("@/lib/prototyping/providers/gemini-client", () => ({
  geminiConfigured: () => true,
  callGemini: async () => {
    const next = state.answers.shift();
    return { raw: next, rawText: JSON.stringify(next ?? null), model: "fake-model", latencyMs: 1, usage: { input: 900, output: 120, total: 1020 } };
  },
}));

const { POST } = await import("@/app/api/studio/spec/route");

const P = "11111111-1111-4111-8111-111111111111";
const USER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", is_anonymous: false };
const consent = { aiConsent: { at: "2026-10-25T00:00:00.000Z", destination: "Google Gemini" } };

/** A card, with the scope the model reported for it. */
const card = (over: Partial<ProductSpec> & { scope?: ProductSpec["scope"] } = {}): ProductSpec =>
  clampSpec({
    name: "Plant waterer",
    oneLine: "Waters a plant when the soil is dry",
    use: "desk",
    power: "usb",
    environment: "indoor",
    features: [],
    inputs: [],
    outputs: ["led"],
    sizeHint: "palm",
    style: "rounded",
    quantity: 1,
    understanding: {
      goal: "Water the plant when the soil gets dry",
      howItWorks: "A probe reads the soil; the board runs the pump.",
      controller: "Arduino Uno",
      sensors: [{ name: "Soil moisture sensor", count: 1 }],
      actuators: [],
      outputs: [{ name: "LED", count: 1 }],
    },
    scope: { controllers: 1 },
    ...over,
  });

const TIER1 = card();
/** A 4-axis machine: Tier 2 through the scope, not through the part counts. */
const TIER2 = card({ scope: { controllers: 1, axes: 4 } });
/** A different product entirely (identity words share nothing with the waterer). */
const ARM = card({
  name: "Bench arm",
  oneLine: "A desktop robot arm that moves parts on a bench",
  understanding: {
    goal: "Move parts around on a workbench",
    howItWorks: "Three joints swing the arm; a gripper picks the part up.",
    controller: "ESP32 DevKit",
    sensors: [],
    actuators: [],
    outputs: [],
  },
  scope: { controllers: 1, axes: 4 },
});

function setup(storedTier = "explorer", balance = 20, role: "user" | "admin" = "user") {
  state.claimed = new Set();
  const tables: Record<string, Record<string, unknown>[]> = {
    projects: [{ id: P, user_id: USER.id, spec: consent, brief: "a plant waterer", studio: null, studio_version: 0 }],
    profiles: [{ id: USER.id, role: role === "admin" ? "super_admin" : "client" }],
    analysis_runs: [],
  };
  const session = { tier: storedTier, balance };
  state.main = fakeSupabase({
    tables,
    user: USER as FakeDb["user"],
    rpc: {
      idea_token_status: () => ({
        data: { role, balance: session.balance, started: true, edit_turns: 3, tokens_used: 0, tier: session.tier },
      }),
      idea_token_charge: (a) => {
        const amount = role === "admin" ? 0 : Number(a.p_amount);
        if (amount > session.balance) return { data: { ok: false, error: "no_tokens", balance: session.balance } };
        session.balance -= amount;
        session.tier = String(a.p_tier);
        return { data: { ok: true, charged: amount, balance: session.balance, edit_turns: 4, tokens_used: amount } };
      },
      // 0106: the claim is single-shot per (project, idea key).
      idea_charge_claim: (a) => {
        const key = a.p_idea_key ? `${a.p_project}:${a.p_idea_key}` : null;
        if (key && state.claimed.has(key)) return { data: null };
        if (key) state.claimed.add(key);
        return { data: `row-${state.claimed.size}-${Date.now()}` };
      },
      idea_charge_fill: () => ({ data: null }),
    },
  });
  return session;
}

const calls = (fn: string) => state.main.db.rpcCalls.filter((c) => c.fn === fn);

async function turn(opts: { idea: string; current: ProductSpec; answer: unknown; approveTier?: string }) {
  state.answers = [opts.answer];
  const res = await POST(
    new Request("http://localhost/api/studio/spec", {
      method: "POST",
      body: JSON.stringify({
        projectId: P,
        locale: "en",
        idea: opts.idea,
        messages: [{ role: "user", text: opts.idea }],
        current: opts.current,
        ...(opts.approveTier ? { approveTier: opts.approveTier } : {}),
      }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

/** A refine answer from the model: the rebuilt card plus its labels. */
const refine = (spec: ProductSpec, over: Record<string, unknown> = {}) => ({
  diff: ["the user asked for a change"],
  spec,
  reply: "Updated your card.",
  changed: ["Changed"],
  newProduct: false,
  ...over,
});

describe("/api/studio/spec — refining is free", () => {
  beforeEach(() => setup());

  it("a refinement inside the stored tier charges nothing", async () => {
    const r = await turn({ idea: "add a status light to the waterer", current: TIER1, answer: refine(card({ outputs: ["led", "buzzer"] })) });
    expect(r.status).toBe(200);
    expect(r.body.spec).toBeTruthy();
    expect(r.body.needsApproval).toBeUndefined();
    expect(calls("idea_token_charge")).toHaveLength(0);
    expect(calls("idea_charge_claim")).toHaveLength(0);
  });

  it("several refinements in a row stay free", async () => {
    const sets: ProductSpec["outputs"][] = [["led"], ["led", "buzzer"], ["led", "buzzer", "screen"]];
    for (const [i, outputs] of sets.entries()) {
      const r = await turn({ idea: `refinement ${i} of the waterer`, current: TIER1, answer: refine(card({ outputs })) });
      expect(r.status).toBe(200);
      expect(r.body.needsApproval).toBeUndefined();
    }
    expect(calls("idea_token_charge")).toHaveLength(0);
  });
});

describe("/api/studio/spec — the tier checkpoint", () => {
  it("pauses with the exact cost and withholds the card", async () => {
    setup();
    const r = await turn({ idea: "make the waterer a 4-axis machine", current: TIER1, answer: refine(TIER2) });
    expect(r.status).toBe(200);
    expect(r.body.needsApproval).toMatchObject({ kind: "escalation", fromTier: "explorer", tier: "maker", level: 2, tokens: 7 });
    expect(r.body.spec).toBeUndefined();
    expect(r.body.reply).toBe("Updated your card.");
    // The balance line still shows the tier they are on, and nothing was charged.
    expect(r.body.tokens).toMatchObject({ tier: "explorer", balance: 20 });
    expect(calls("idea_token_charge")).toHaveLength(0);
    // The quote is recorded, so a decline is countable (0106 stage 'quoted').
    const quote = calls("idea_charge_claim");
    expect(quote).toHaveLength(1);
    expect(quote[0].args).toMatchObject({ p_stage: "quoted", p_kind: "escalation", p_estimated: 7 });
    expect(String(quote[0].args.p_idea_key)).toMatch(/^q:/);
  });

  it("the same checkpoint shown twice records one quote, and declining charges nothing", async () => {
    setup();
    const idea = "4-axis machine, shown twice";
    const first = await turn({ idea, current: TIER1, answer: refine(TIER2) });
    const again = await turn({ idea, current: TIER1, answer: refine(TIER2) });
    expect(first.body.needsApproval).toBeTruthy();
    expect(again.body.needsApproval).toBeTruthy();
    // Both turns ask the database; the unique quote key keeps it to one row.
    const quotes = calls("idea_charge_claim");
    expect(quotes).toHaveLength(2);
    expect(quotes[0].args.p_idea_key).toBe(quotes[1].args.p_idea_key);
    expect(quotes.every((c) => c.args.p_stage === "quoted")).toBe(true);
    // Declining is simply not answering: nothing was charged and the card is withheld.
    expect(calls("idea_token_charge")).toHaveLength(0);
    expect(first.body.spec).toBeUndefined();
  });

  it("approval charges exactly the agreed amount and hands the card over", async () => {
    setup();
    const idea = "make the waterer a 4-axis machine, approved";
    await turn({ idea, current: TIER1, answer: refine(TIER2) });
    const r = await turn({ idea, current: TIER1, answer: refine(TIER2), approveTier: "maker" });
    expect(r.status).toBe(200);
    expect(r.body.spec).toBeTruthy();
    expect(r.body.needsApproval).toBeUndefined();
    const charge = calls("idea_token_charge");
    expect(charge).toHaveLength(1);
    expect(charge[0].args).toMatchObject({ p_amount: 7, p_tier: "maker", p_edit: false });
    expect(r.body.tokens).toMatchObject({ balance: 13, tier: "maker", charged: 7 });
    // Estimated vs actual: the agreed 7, beside what the model consumed.
    const claimed = calls("idea_charge_claim");
    // The quote (from the paused turn) first, then the charge itself.
    expect(claimed[0].args).toMatchObject({ p_stage: "quoted" });
    expect(claimed[1].args).toMatchObject({ p_stage: "charged", p_kind: "escalation", p_estimated: 7, p_idea_key: null });
    expect(calls("idea_charge_fill")[0].args).toMatchObject({ p_charged: 7, p_model: "fake-model" });
  });

  it("the same escalation sent again charges nothing (the stored tier is the guard)", async () => {
    const session = setup();
    const idea = "4-axis machine, replayed";
    await turn({ idea, current: TIER1, answer: refine(TIER2), approveTier: "maker" });
    expect(session.balance).toBe(13);
    await turn({ idea, current: TIER2, answer: refine(TIER2), approveTier: "maker" });
    expect(session.balance).toBe(13);
    expect(calls("idea_token_charge")).toHaveLength(1);
  });

  it("too few tokens answers 402 before anything is charged", async () => {
    setup("explorer", 3);
    const r = await turn({ idea: "4-axis machine on an empty balance", current: TIER1, answer: refine(TIER2), approveTier: "maker" });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ error: "no_tokens", need: 7 });
    expect(calls("idea_token_charge")).toHaveLength(0);
  });

  it("an admin is never stopped and never charged", async () => {
    setup("explorer", 0, "admin");
    const r = await turn({ idea: "4-axis machine as the admin", current: TIER1, answer: refine(TIER2) });
    expect(r.status).toBe(200);
    expect(r.body.spec).toBeTruthy();
    expect(r.body.needsApproval).toBeUndefined();
    expect(calls("idea_token_charge")).toHaveLength(0);
    // Still recorded, at 0 tokens, so the admin's own turns show up in the report.
    expect(calls("idea_charge_claim")[0].args).toMatchObject({ p_kind: "escalation", p_estimated: 0, p_stage: "charged" });
  });
});

describe("/api/studio/spec — a different product", () => {
  it("asks first, then charges the new product's own tier once", async () => {
    const session = setup("maker", 20);
    const idea = "actually make it a robot arm for the bench";
    const answer = refine(ARM, { newProduct: true });
    const paused = await turn({ idea, current: TIER1, answer });
    expect(paused.body.needsApproval).toMatchObject({ kind: "new_product", tier: "maker", tokens: 7 });
    expect(paused.body.spec).toBeUndefined();
    expect(calls("idea_token_charge")).toHaveLength(0);

    const ok = await turn({ idea, current: TIER1, answer, approveTier: "maker" });
    expect(ok.body.spec).toBeTruthy();
    expect(session.balance).toBe(13);
    expect(calls("idea_charge_claim").find((c) => c.args.p_stage === "charged")?.args).toMatchObject({
      p_kind: "new_product",
      p_idea_key: ideaKey(ARM),
    });

    // The same approval again (a double click, a retried request): claimed already, so free.
    const replay = await turn({ idea, current: TIER1, answer, approveTier: "maker" });
    expect(replay.body.spec).toBeTruthy();
    expect(session.balance).toBe(13);
    expect(calls("idea_token_charge")).toHaveLength(1);
  });

  it("a rewritten card the model does NOT flag stays a free refinement", async () => {
    setup("maker", 20);
    const r = await turn({ idea: "reword the card", current: TIER1, answer: refine(ARM) });
    expect(r.body.needsApproval).toBeUndefined();
    expect(r.body.spec).toBeTruthy();
    expect(calls("idea_token_charge")).toHaveLength(0);
  });
});
