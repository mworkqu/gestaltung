// One brief analysis, end to end (the body of POST /api/analyse): reuse a
// stored run for an identical request, else gate (provider configured, daily
// guard, per-person credit allowance), call the provider, validate its answer
// step by step, fall back to the basic reader on any failure, meter the call
// and record the run. Yields the same AnalysisEvent steps the NDJSON stream
// sends, in the same order; every I/O is injected through `AnalyseDeps`.
//
// Pure of Next/Supabase imports (types only) so the sequencing is unit-tested
// with a fake provider. The route keeps auth, Turnstile and body validation.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProviderId } from "@/lib/ai/limits";
import type { UsageRow } from "@/lib/ai/usage";
import {
  honestSources,
  withStandardGaps,
  type Analysis,
  type AnalysisEvent,
  type AnalysisRequest,
  type FallbackReason,
} from "@/lib/prototyping/analysis";
import { analysisFingerprint } from "@/lib/prototyping/analysis-request";
import { AnalysisSchema, DisciplinesSchema, RequirementsSchema } from "@/lib/prototyping/analysis-schema";
import { ProviderError, type AnalysisProvider, type TokenUsage } from "@/lib/prototyping/providers/types";

/** Providers the daily guard meters. Others (the basic reader) cost nothing. */
export const METERED: Record<string, ProviderId> = { gemini: "gemini" };

export type AnalyseDeps = {
  /** The caller's cookie-bound (RLS) client: analysis_runs reads and writes. */
  db: SupabaseClient;
  userId: string;
  /** The configured provider's name (ANALYSIS_PROVIDER). */
  providerName: string;
  loadProvider: (name: string) => Promise<AnalysisProvider | null>;
  /** The provider's daily share of the free allowance is used up. */
  quotaPaused: (provider: ProviderId) => Promise<boolean>;
  /** The "bom" step's per-person daily allowance (0042) still has room. */
  creditAllowed: () => Promise<boolean>;
  logUsage: (row: UsageRow) => Promise<void>;
  /** The basic reader (keyword rules). */
  readWithRules: (req: AnalysisRequest) => Promise<Analysis>;
};

/**
 * The same brief and the same answers as a run we already paid for: that run's
 * answer. The stored result still goes through the schema — a row written by an
 * older shape of the analysis is not reused rather than shown unvalidated.
 */
async function priorRun(db: SupabaseClient, req: AnalysisRequest, fingerprint: string) {
  if (!req.projectId) return null;
  const { data: prior } = await db
    .from("analysis_runs")
    .select("parsed_response, provider, created_at")
    .eq("project_id", req.projectId)
    .eq("feature", "analyse")
    .eq("request_hash", fingerprint)
    .in("outcome", ["ok", "fallback"])
    .not("parsed_response", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const stored = prior ? AnalysisSchema.safeParse(prior.parsed_response) : null;
  return prior && stored?.success ? { analysis: stored.data, provider: prior.provider as string, runAt: prior.created_at as string } : null;
}

/** Insert the run. Before 0099 there is no request_hash column: record it as before, so only the reuse is missing, not the diagnostics. */
async function recordRun(db: SupabaseClient, row: Record<string, unknown>, fingerprint: string): Promise<void> {
  let { error: runErr } = await db.from("analysis_runs").insert({ ...row, request_hash: fingerprint });
  if (runErr?.code === "PGRST204") {
    ({ error: runErr } = await db.from("analysis_runs").insert(row));
    if (!runErr) console.warn("[analyse] run recorded without its request fingerprint (migration 0099?)");
  }
  if (runErr) console.warn(`[analyse] run not recorded (migration 0024?): ${runErr.message}`);
}

type Attempt = {
  analysis: Analysis | null;
  fallback: FallbackReason | null;
  /** "rules" once the basic reader has taken over. */
  usedProvider: string;
  /** The provider was actually called (not just gated). */
  called: boolean;
  model?: string;
  usage?: TokenUsage;
  latencyMs?: number;
  rawText?: string;
  rawJson?: unknown;
  errorText: string | null;
};

/**
 * The gates and the provider call, validated step by step. Any failure ends in
 * a fallback reason (never a throw) with whatever usage the provider reported.
 */
async function* callProvider(deps: AnalyseDeps, req: AnalysisRequest): AsyncGenerator<AnalysisEvent, Attempt, void> {
  const name = deps.providerName;
  const a: Attempt = { analysis: null, fallback: null, usedProvider: name, called: false, errorText: null };
  const metered = METERED[name];
  try {
    const provider = await deps.loadProvider(name);
    if (!provider) throw new ProviderError("unavailable", `unknown provider "${name}"`);
    if (!provider.configured()) throw new ProviderError("missing_key");
    if (metered && (await deps.quotaPaused(metered))) throw new ProviderError("paused");
    // Over the per-person allowance, the basic reader answers instead and says why.
    if (metered && !(await deps.creditAllowed())) throw new ProviderError("daily_limit");

    a.called = true;
    const result = await provider.analyse(req);
    ({ model: a.model, usage: a.usage, latencyMs: a.latencyMs, rawText: a.rawText } = result);
    a.rawJson = result.raw;
    const raw = (result.raw ?? {}) as Record<string, unknown>;

    if (!DisciplinesSchema.safeParse(raw.disciplines).success) throw new ProviderError("malformed", "disciplines");
    yield { type: "step", step: "disciplines" };

    if (!RequirementsSchema.safeParse(raw).success) throw new ProviderError("malformed", "requirements/questions");
    yield { type: "step", step: "requirements" };

    // Unknown keys (a `confidence` the model added, say) are stripped here.
    const full = AnalysisSchema.safeParse(raw);
    if (!full.success) throw new ProviderError("malformed", "summary/suggestedParts");
    a.analysis = full.data;
  } catch (e) {
    a.fallback = e instanceof ProviderError ? e.reason : "unavailable";
    const err = e as { usage?: TokenUsage; latencyMs?: number; model?: string; rawText?: string };
    a.rawText ??= err.rawText;
    a.errorText = `${a.fallback}: ${e instanceof Error ? e.message : String(e)}`;
    a.usage ??= err.usage;
    a.latencyMs ??= err.latencyMs;
    a.model ??= err.model;
    console.warn(`[analyse] ${name} failed (${a.fallback}): ${e instanceof Error ? e.message : e}. Using the basic reader.`);
    a.usedProvider = "rules";
  }
  return a;
}

export async function* runAnalysis(deps: AnalyseDeps, req: AnalysisRequest): AsyncGenerator<AnalysisEvent, void, void> {
  const { db, providerName: name } = deps;
  yield { type: "step", step: "reading" };

  const fingerprint = analysisFingerprint(req);
  const reused = await priorRun(db, req, fingerprint);
  if (reused) {
    for (const step of ["disciplines", "requirements"] as const) yield { type: "step", step };
    yield { type: "result", analysis: reused.analysis, provider: reused.provider, fallback: null, reused: true, runAt: reused.runAt };
    return;
  }

  const attempt = yield* callProvider(deps, req);
  let analysis = attempt.analysis;
  const { fallback, called, model, usage, latencyMs, rawText, rawJson, errorText, usedProvider } = attempt;
  const metered = METERED[name];

  if (metered && (called || fallback === "paused")) {
    await deps.logUsage({
      userId: deps.userId,
      provider: metered,
      model,
      projectId: req.projectId,
      feature: "analyse",
      promptTokens: usage?.input,
      completionTokens: usage?.output,
      totalTokens: usage?.total,
      latencyMs,
      outcome: fallback === "paused" ? "blocked" : fallback ? "error" : "ok",
      errorCode: fallback,
    });
  }

  try {
    if (!analysis) {
      analysis = await deps.readWithRules(req);
      yield { type: "step", step: "disciplines" };
      yield { type: "step", step: "requirements" };
    }
    // Every provider's "from your brief" is checked against the brief's own
    // words before anyone sees it (audit #5).
    const normalised = withStandardGaps(analysis);
    const final = { ...normalised, requirements: honestSources(normalised.requirements, req.brief) };
    if (req.projectId) {
      const row = {
        project_id: req.projectId,
        feature: "analyse",
        provider: called ? name : usedProvider,
        model: model ?? null,
        raw_text: rawText ?? null,
        raw_response: rawJson ?? null,
        parsed_response: final,
        outcome: usedProvider === name ? "ok" : "fallback",
        error: errorText,
      };
      await recordRun(db, row, fingerprint);
    }
    yield {
      type: "result",
      analysis: final,
      provider: usedProvider,
      fallback: usedProvider === name ? null : fallback,
    };
  } catch (e) {
    console.error("[analyse] basic reader failed:", e);
    yield { type: "error" };
  }
}
