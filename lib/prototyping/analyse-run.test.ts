import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UsageRow } from "@/lib/ai/usage";
import type { Analysis, AnalysisEvent, AnalysisRequest } from "@/lib/prototyping/analysis";
import { analysisFingerprint } from "@/lib/prototyping/analysis-request";
import { ProviderError, type AnalysisProvider } from "@/lib/prototyping/providers/types";

import { runAnalysis, type AnalyseDeps } from "./analyse-run";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const req: AnalysisRequest = { brief: "A small robot arm that waves", answers: [], locale: "en", projectId: PROJECT };

const RAW = {
  summary: "A waving arm.",
  disciplines: ["mechanical", "electronics"],
  requirements: [{ id: "reach", label: "Reach", value: 300, source: "assumed" }],
  questions: [],
  suggestedParts: [],
  confidence: 0.9, // stripped by the schema
};
const BASIC: Analysis = { summary: "", disciplines: ["mechanical"], requirements: [], questions: [], suggestedParts: [], bom: [] };

type Insert = Record<string, unknown>;

/** analysis_runs stand-in: a stored prior row (optional) and recorded inserts. */
function fakeDb(opts: { prior?: { parsed_response: unknown; provider: string; created_at: string } | null; insertErrors?: ({ code?: string; message: string } | null)[] } = {}) {
  const inserts: Insert[] = [];
  const errors = [...(opts.insertErrors ?? [])];
  const query: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "order", "limit"]) query[m] = () => query;
  query.maybeSingle = async () => ({ data: opts.prior ?? null, error: null });
  const db = {
    from: () => ({
      ...query,
      insert: async (row: Insert) => {
        inserts.push(row);
        return { error: errors.shift() ?? null };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, inserts };
}

function provider(over: Partial<AnalysisProvider> = {}): AnalysisProvider {
  return {
    name: "gemini",
    destination: "Google",
    configured: () => true,
    analyse: async () => ({ raw: RAW, model: "m1", usage: { input: 10, output: 5, total: 15 }, latencyMs: 12, rawText: "{...}" }),
    ...over,
  };
}

function setup(over: Partial<AnalyseDeps> & { prior?: Parameters<typeof fakeDb>[0] } = {}) {
  const { db, inserts } = fakeDb(over.prior ? over.prior : {});
  const usage: UsageRow[] = [];
  const calls = { quota: 0, credit: 0, rules: 0, analyse: 0 };
  const p = provider();
  const deps: AnalyseDeps = {
    db,
    userId: "user-1",
    providerName: "gemini",
    loadProvider: async () => ({
      ...p,
      analyse: async (r) => {
        calls.analyse++;
        return p.analyse(r);
      },
    }),
    quotaPaused: async () => {
      calls.quota++;
      return false;
    },
    creditAllowed: async () => {
      calls.credit++;
      return true;
    },
    logUsage: async (row) => {
      usage.push(row);
    },
    readWithRules: async () => {
      calls.rules++;
      return BASIC;
    },
    ...over,
  };
  return { deps, inserts, usage, calls };
}

async function collect(deps: AnalyseDeps, r: AnalysisRequest = req): Promise<AnalysisEvent[]> {
  const out: AnalysisEvent[] = [];
  for await (const e of runAnalysis(deps, r)) out.push(e);
  return out;
}
const steps = (ev: AnalysisEvent[]) => ev.filter((e) => e.type === "step").map((e) => (e as { step: string }).step);
const result = (ev: AnalysisEvent[]) => ev.find((e) => e.type === "result") as Extract<AnalysisEvent, { type: "result" }>;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("runAnalysis - provider success", () => {
  it("streams reading -> disciplines -> requirements -> result, then records and meters the run", async () => {
    const t = setup();
    const ev = await collect(t.deps);
    expect(steps(ev)).toEqual(["reading", "disciplines", "requirements"]);
    expect(ev.map((e) => e.type)).toEqual(["step", "step", "step", "result"]);
    const r = result(ev);
    expect(r).toMatchObject({ provider: "gemini", fallback: null });
    expect(r.analysis.disciplines).toEqual(["mechanical", "electronics"]);
    expect(r.analysis.requirements[0]).toMatchObject({ id: "reach", value: "300" });
    expect(r.analysis).not.toHaveProperty("confidence");
    expect(t.calls).toMatchObject({ quota: 1, credit: 1, analyse: 1, rules: 0 });
    expect(t.usage).toEqual([
      expect.objectContaining({ userId: "user-1", provider: "gemini", model: "m1", feature: "analyse", projectId: PROJECT, promptTokens: 10, completionTokens: 5, totalTokens: 15, latencyMs: 12, outcome: "ok", errorCode: null }),
    ]);
    expect(t.inserts).toHaveLength(1);
    expect(t.inserts[0]).toMatchObject({
      project_id: PROJECT,
      feature: "analyse",
      provider: "gemini",
      model: "m1",
      raw_text: "{...}",
      outcome: "ok",
      error: null,
      request_hash: analysisFingerprint(req),
    });
  });

  it("does not record a run without a project", async () => {
    const t = setup();
    const ev = await collect(t.deps, { ...req, projectId: undefined });
    expect(result(ev).provider).toBe("gemini");
    expect(t.inserts).toEqual([]);
  });
});

describe("runAnalysis - gates fall back to the basic reader", () => {
  it("paused daily guard: no provider call, usage logged as blocked", async () => {
    const t = setup({ quotaPaused: async () => true });
    const ev = await collect(t.deps);
    expect(steps(ev)).toEqual(["reading", "disciplines", "requirements"]);
    expect(result(ev)).toMatchObject({ provider: "rules", fallback: "paused" });
    expect(t.calls.analyse).toBe(0);
    expect(t.calls.rules).toBe(1);
    expect(t.usage[0]).toMatchObject({ outcome: "blocked", errorCode: "paused" });
    expect(t.inserts[0]).toMatchObject({ provider: "rules", outcome: "fallback", error: "paused: paused" });
  });

  it("daily credit limit: provider not called and nothing metered", async () => {
    const t = setup({ creditAllowed: async () => false });
    const ev = await collect(t.deps);
    expect(result(ev)).toMatchObject({ provider: "rules", fallback: "daily_limit" });
    expect(t.calls.analyse).toBe(0);
    expect(t.usage).toEqual([]);
  });

  it("gates run in order: provider configured, then quota, then credit", async () => {
    const t = setup({ loadProvider: async () => provider({ configured: () => false }) });
    const ev = await collect(t.deps);
    expect(result(ev).fallback).toBe("missing_key");
    expect(t.calls.quota).toBe(0);
    expect(t.calls.credit).toBe(0);
    expect(t.usage).toEqual([]);
  });

  it("an unknown provider is unavailable", async () => {
    const t = setup({ loadProvider: async () => null });
    expect(result(await collect(t.deps)).fallback).toBe("unavailable");
  });

  it("an unmetered provider skips both gates and the usage log", async () => {
    const t = setup({ providerName: "rules", loadProvider: async () => provider({ name: "rules" }) });
    const ev = await collect(t.deps);
    expect(result(ev)).toMatchObject({ provider: "rules", fallback: null });
    expect(t.calls.quota + t.calls.credit).toBe(0);
    expect(t.usage).toEqual([]);
  });
});

describe("runAnalysis - malformed provider answers", () => {
  it("bad disciplines: no disciplines step from the provider; basic reader's steps follow; usage is an error", async () => {
    const t = setup({
      loadProvider: async () => provider({ analyse: async () => ({ raw: { ...RAW, disciplines: ["alchemy"] }, model: "m1" }) }),
    });
    const ev = await collect(t.deps);
    expect(steps(ev)).toEqual(["reading", "disciplines", "requirements"]); // the basic reader's pair
    expect(result(ev)).toMatchObject({ provider: "rules", fallback: "malformed" });
    expect(t.usage[0]).toMatchObject({ outcome: "error", errorCode: "malformed", model: "m1" });
    expect(t.inserts[0]).toMatchObject({ outcome: "fallback", provider: "gemini", error: "malformed: disciplines" });
  });

  it("bad requirements: the disciplines step was already sent before the failure", async () => {
    const t = setup({
      loadProvider: async () => provider({ analyse: async () => ({ raw: { ...RAW, requirements: [{ id: "BAD" }] } }) }),
    });
    const ev = await collect(t.deps);
    expect(steps(ev)).toEqual(["reading", "disciplines", "disciplines", "requirements"]);
    expect(result(ev).fallback).toBe("malformed");
  });

  it("bad summary: both provider steps were sent, then the fallback repeats them", async () => {
    const t = setup({
      loadProvider: async () => provider({ analyse: async () => ({ raw: { ...RAW, summary: "x".repeat(2000) } }) }),
    });
    const ev = await collect(t.deps);
    expect(steps(ev)).toEqual(["reading", "disciplines", "requirements", "disciplines", "requirements"]);
    expect(result(ev).fallback).toBe("malformed");
  });

  it("a provider that throws keeps its usage and reason", async () => {
    const t = setup({
      loadProvider: async () =>
        provider({
          analyse: async () => {
            throw Object.assign(new ProviderError("rate_limited", "429"), { usage: { input: 1, output: 0, total: 1 }, latencyMs: 7 });
          },
        }),
    });
    const ev = await collect(t.deps);
    expect(result(ev).fallback).toBe("rate_limited");
    expect(t.usage[0]).toMatchObject({ outcome: "error", errorCode: "rate_limited", promptTokens: 1, latencyMs: 7 });
  });

  it("a non-ProviderError becomes unavailable", async () => {
    const t = setup({
      loadProvider: async () =>
        provider({
          analyse: async () => {
            throw new Error("network");
          },
        }),
    });
    expect(result(await collect(t.deps)).fallback).toBe("unavailable");
  });
});

describe("runAnalysis - reuse and recording", () => {
  it("an identical stored run is replayed: no gates, no provider, no new row, flagged reused", async () => {
    const stored = { ...BASIC, summary: "stored", disciplines: ["mechanical"], requirements: [], questions: [], suggestedParts: [], bom: [] };
    const t = setup({ prior: { prior: { parsed_response: stored, provider: "gemini", created_at: "2026-10-01T00:00:00Z" } } });
    const ev = await collect(t.deps);
    expect(steps(ev)).toEqual(["reading", "disciplines", "requirements"]);
    expect(result(ev)).toMatchObject({ provider: "gemini", fallback: null, reused: true, runAt: "2026-10-01T00:00:00Z" });
    expect(result(ev).analysis.summary).toBe("stored");
    expect(t.calls).toEqual({ quota: 0, credit: 0, rules: 0, analyse: 0 });
    expect(t.inserts).toEqual([]);
    expect(t.usage).toEqual([]);
  });

  it("a stored row in an older shape is not reused", async () => {
    const t = setup({ prior: { prior: { parsed_response: { summary: 5 }, provider: "gemini", created_at: "2026-10-01T00:00:00Z" } } });
    const ev = await collect(t.deps);
    expect(result(ev).reused).toBeUndefined();
    expect(t.calls.analyse).toBe(1);
  });

  it("before 0099 (PGRST204) the run is recorded again without its fingerprint", async () => {
    const { db, inserts } = fakeDb({ insertErrors: [{ code: "PGRST204", message: "no request_hash" }, null] });
    const t = setup({ db });
    await collect(t.deps);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toHaveProperty("request_hash");
    expect(inserts[1]).not.toHaveProperty("request_hash");
  });

  it("a failed basic reader ends the stream with an error event", async () => {
    const t = setup({
      loadProvider: async () => null,
      readWithRules: async () => {
        throw new Error("i18n");
      },
    });
    const ev = await collect(t.deps);
    expect(ev.at(-1)).toEqual({ type: "error" });
    expect(ev.some((e) => e.type === "result")).toBe(false);
  });
});
