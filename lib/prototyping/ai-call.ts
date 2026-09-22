// One structured model call, validated, with a single retry. Server-only.
//
// The answer must pass `validate` (zod plus our own reference checks). A
// failure is sent back once with the list of problems; a second failure
// returns the problems and NO value — nothing unvalidated ever leaves here.
// Every attempt is metered (ai_usage) and recorded raw beside parsed
// (analysis_runs), so a wrong answer can be traced to the model or to us.

import type { SupabaseClient } from "@supabase/supabase-js";

import { logUsage, quota } from "@/lib/ai/usage";
import { callGemini, geminiConfigured } from "./providers/gemini-client";
import { ProviderError, type TokenUsage } from "./providers/types";

export type CallFeature = "netlist" | "electronics";

export type CallResult<T> =
  | { ok: true; value: T; model: string | null }
  | { ok: false; error: "paused" | "unavailable" | "rate_limited" | "invalid"; problems: string[] };

export async function validatedCall<T>(opts: {
  supabase: SupabaseClient;
  projectId: string;
  feature: CallFeature;
  system: string;
  prompt: string;
  schema: object;
  validate: (raw: unknown) => { value: T | null; errors: string[] };
}): Promise<CallResult<T>> {
  const { supabase, projectId, feature } = opts;
  if (!geminiConfigured()) return { ok: false, error: "unavailable", problems: [] };
  if ((await quota(supabase, "gemini")).paused) {
    await logUsage(supabase, { provider: "gemini", projectId, feature, outcome: "blocked", errorCode: "paused" });
    return { ok: false, error: "paused", problems: [] };
  }

  const record = async (row: { model: string | null; attempt: number; rawText: string | null; raw: unknown; parsed: unknown; outcome: "ok" | "invalid" | "error"; errors: string[] }) => {
    const { error } = await supabase.from("analysis_runs").insert({
      project_id: projectId,
      feature,
      provider: "gemini",
      model: row.model,
      attempt: row.attempt,
      raw_text: row.rawText,
      raw_response: row.raw ?? null,
      parsed_response: row.parsed ?? null,
      outcome: row.outcome,
      error: row.errors.length ? row.errors.join("\n") : null,
    });
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
      const r = await callGemini({ system: opts.system, prompt, schema: opts.schema, temperature: 0.1 });
      ({ usage, latencyMs } = r);
      rawText = r.rawText;
      raw = r.raw;
      model = r.model;
      ({ value, errors } = opts.validate(r.raw));
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
          provider: "gemini", model, projectId, feature,
          promptTokens: usage?.input, completionTokens: usage?.output, totalTokens: usage?.total,
          latencyMs, outcome: "error", errorCode: e.reason,
        });
        return { ok: false, error: e.reason === "rate_limited" ? "rate_limited" : "unavailable", problems: errors };
      }
    }
    await logUsage(supabase, {
      provider: "gemini", model, projectId, feature,
      promptTokens: usage?.input, completionTokens: usage?.output, totalTokens: usage?.total,
      latencyMs, outcome: value ? "ok" : "error", errorCode: value ? null : "invalid",
    });
    await record({ model, attempt, rawText, raw, parsed: value, outcome: value ? "ok" : "invalid", errors: value ? [] : errors });
    if (value) return { ok: true, value, model };
    console.warn(`[${feature}] attempt ${attempt} rejected: ${errors.join("; ")}`);
  }
  return { ok: false, error: "invalid", problems: errors.slice(0, 6) };
}
