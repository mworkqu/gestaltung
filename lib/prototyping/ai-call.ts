// One structured model call, validated, with a single retry. Server-only.
//
// The answer must pass `validate` (zod plus our own reference checks). A
// failure is sent back once with the list of problems; a second failure
// returns the problems and NO value — nothing unvalidated ever leaves here.
// Every attempt is metered (ai_usage) and recorded raw beside parsed
// (analysis_runs), so a wrong answer can be traced to the model or to us.
//
// `reuse` makes that record durable money: the request's fingerprint goes on
// the row, and an identical request is answered from the row instead of the
// provider. The in-memory caches above this (lib/studio/ai/cache.ts) cannot do
// that on Vercel — the next press lands on another instance and pays again.

import type { SupabaseClient } from "@supabase/supabase-js";

import { logUsage, quota } from "@/lib/ai/usage";
import { callFingerprint } from "./call-fingerprint";
import { callGemini, geminiConfigured } from "./providers/gemini-client";
import { ProviderError, type TokenUsage } from "./providers/types";

export type CallFeature = "netlist" | "electronics" | "cad" | "studio" | "billing";

/** The provider call; tests inject a fake (then the key check is skipped). */
export type ModelCaller = typeof callGemini;

export type CallResult<T> =
  | { ok: true; value: T; model: string | null }
  | { ok: false; error: "paused" | "unavailable" | "rate_limited" | "invalid"; problems: string[] };

export async function validatedCall<T>(opts: {
  supabase: SupabaseClient;
  /** null = not tied to a project (billing: the Fawran proof check). */
  projectId: string | null;
  feature: CallFeature;
  system: string;
  prompt: string;
  schema: object;
  /** `attempt` is 1 on the first ask, 2 on the retry (and 1 when a stored answer is read back). */
  validate: (raw: unknown, attempt: number) => { value: T | null; errors: string[] };
  /** Sub-step, written to the usage log line and the analysis_runs error text. */
  step?: string;
  /** Defaults to 0.1 (existing callers). */
  temperature?: number;
  /** Defaults to 90 s (existing callers). */
  timeoutMs?: number;
  /** Injected provider call (tests). Defaults to callGemini. */
  caller?: ModelCaller;
  /** Inline images for a vision call (Studio product check). */
  images?: Parameters<ModelCaller>[0]["images"];
  /** First model to ask (default GEMINI_MODEL). */
  model?: string;
  /** Answer an identical earlier request for this project from its stored run instead of calling again. */
  reuse?: boolean;
}): Promise<CallResult<T>> {
  const { supabase, projectId, feature, step } = opts;
  const caller = opts.caller ?? callGemini;

  // One fingerprint for the whole call, including the retry: it names the
  // request, not the attempt, so the row a retry finally answered is found by
  // the next identical request.
  const fingerprint =
    opts.reuse && projectId
      ? callFingerprint({ step, system: opts.system, prompt: opts.prompt, schema: opts.schema, model: opts.model, images: opts.images })
      : null;

  // A request we already paid for. The stored RAW answer goes back through the
  // same `validate` as a live one, so a row written by an older shape of this
  // step is paid for again rather than handed over unchecked. Before the
  // provider guards: a stored answer costs nothing, so neither the daily guard
  // nor a missing key is a reason to refuse it.
  if (fingerprint) {
    const { data: prior } = await supabase
      .from("analysis_runs")
      .select("raw_response, model")
      .eq("project_id", projectId)
      .eq("feature", feature)
      .eq("request_hash", fingerprint)
      .eq("outcome", "ok")
      .not("raw_response", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior) {
      const row = prior as { raw_response: unknown; model: string | null };
      const { value } = opts.validate(row.raw_response, 1);
      if (value) {
        console.info(`[${feature}${step ? `/${step}` : ""}] reused an identical earlier answer, no model call`);
        return { ok: true, value, model: row.model };
      }
    }
  }

  if (!opts.caller && !geminiConfigured()) return { ok: false, error: "unavailable", problems: [] };
  if ((await quota(supabase, "gemini")).paused) {
    await logUsage(supabase, { provider: "gemini", projectId, feature, step, outcome: "blocked", errorCode: "paused" });
    return { ok: false, error: "paused", problems: [] };
  }

  const record = async (row: { model: string | null; attempt: number; rawText: string | null; raw: unknown; parsed: unknown; outcome: "ok" | "invalid" | "error"; errors: string[] }) => {
    if (!projectId) return; // analysis_runs rows belong to a project
    const base = {
      project_id: projectId,
      feature,
      provider: "gemini",
      model: row.model,
      attempt: row.attempt,
      raw_text: row.rawText,
      raw_response: row.raw ?? null,
      parsed_response: row.parsed ?? null,
      outcome: row.outcome,
      error: row.errors.length ? `${step ? `[${step}] ` : ""}${row.errors.join("\n")}` : null,
    };
    let { error } = await supabase.from("analysis_runs").insert({ ...base, ...(fingerprint ? { request_hash: fingerprint } : {}) });
    // Before 0099 there is no request_hash column: record the run as before,
    // so only the reuse is missing, not the diagnostics.
    if (fingerprint && error?.code === "PGRST204") {
      ({ error } = await supabase.from("analysis_runs").insert(base));
      if (!error) console.warn(`[${feature}] run recorded without its request fingerprint (migration 0099?)`);
    }
    if (error) console.warn(`[${feature}] run not recorded: ${error.message}`);
  };

  let errors: string[] = [];
  let model: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? opts.prompt
        : `${opts.prompt}\n\nYour previous answer was rejected for these problems. Return a corrected answer:\n${errors.map((e) => `- ${e}`).join("\n")}`;
    let usage: TokenUsage | undefined;
    let latencyMs: number | undefined;
    let rawText: string | null = null;
    let raw: unknown = null;
    let value: T | null = null;
    try {
      const r = await caller({
        system: opts.system,
        prompt,
        schema: opts.schema,
        temperature: opts.temperature ?? 0.1,
        timeoutMs: opts.timeoutMs ?? 90_000,
        ...(opts.images?.length ? { images: opts.images } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      });
      ({ usage, latencyMs } = r);
      rawText = r.rawText;
      raw = r.raw;
      model = r.model;
      ({ value, errors } = opts.validate(r.raw, attempt));
    } catch (e) {
      const err = e as ProviderError & { usage?: TokenUsage; latencyMs?: number; rawText?: string; model?: string };
      usage = err.usage;
      latencyMs = err.latencyMs;
      rawText = err.rawText ?? null;
      model = err.model ?? model;
      errors = [err.reason === "malformed" ? "the answer was not valid JSON" : err.message];
      if (e instanceof ProviderError && e.reason !== "malformed") {
        await record({ model, attempt, rawText, raw: null, parsed: null, outcome: "error", errors });
        await logUsage(supabase, {
          provider: "gemini", model, projectId, feature, step,
          promptTokens: usage?.input, completionTokens: usage?.output, totalTokens: usage?.total,
          latencyMs, outcome: "error", errorCode: e.reason,
        });
        return { ok: false, error: e.reason === "rate_limited" ? "rate_limited" : "unavailable", problems: errors };
      }
    }
    await logUsage(supabase, {
      provider: "gemini", model, projectId, feature, step,
      promptTokens: usage?.input, completionTokens: usage?.output, totalTokens: usage?.total,
      latencyMs, outcome: value ? "ok" : "error", errorCode: value ? null : "invalid",
    });
    await record({ model, attempt, rawText, raw, parsed: value, outcome: value ? "ok" : "invalid", errors: value ? [] : errors });
    if (value) return { ok: true, value, model };
    console.warn(`[${feature}] attempt ${attempt} rejected: ${errors.join("; ")}`);
  }
  return { ok: false, error: "invalid", problems: errors.slice(0, 6) };
}
