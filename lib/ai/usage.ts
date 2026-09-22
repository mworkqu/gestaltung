// AI metering and the daily guard. Server-only.
//
// logUsage() writes one ai_usage row per provider call (migration 0023) —
// what it cost, how long it took, how it ended. quota() answers "may we call
// this provider right now?" from today's rows and lib/ai/limits.
//
// Both go through the caller's own Supabase session and SECURITY DEFINER
// functions, so no service key is needed. If 0023 has not run yet, logging
// warns in the server console and the guard lets calls through (there is
// nothing to count), rather than breaking the feature.

import type { SupabaseClient } from "@supabase/supabase-js";

import { dayStart, guardThreshold, providerLimits, type ProviderId } from "./limits";

export type Feature = "analyse" | "netlist" | "transcribe";

export type UsageRow = {
  provider: ProviderId;
  model?: string | null;
  projectId?: string | null;
  feature: Feature;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  audioSeconds?: number | null;
  latencyMs?: number | null;
  outcome: "ok" | "error" | "blocked";
  errorCode?: string | null;
  remainingRequests?: number | null;
  remainingTokens?: number | null;
};

export async function logUsage(supabase: SupabaseClient, u: UsageRow): Promise<void> {
  // Server console too, so usage is visible even before 0023 runs.
  console.info(
    `[ai] ${u.feature} ${u.provider}${u.model ? ` (${u.model})` : ""} ${u.outcome}${
      u.errorCode ? `:${u.errorCode}` : ""
    } tokens in=${u.promptTokens ?? "-"} out=${u.completionTokens ?? "-"} total=${u.totalTokens ?? "-"}${
      u.audioSeconds != null ? ` audio=${u.audioSeconds}s` : ""
    } ${u.latencyMs ?? "-"}ms${u.remainingRequests != null ? ` remaining-requests=${u.remainingRequests}` : ""}`
  );
  const int = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  const { error } = await supabase.rpc("log_ai_usage", {
    p_provider: u.provider,
    p_model: u.model ?? null,
    p_project: u.projectId ?? null,
    p_feature: u.feature,
    p_prompt_tokens: int(u.promptTokens),
    p_completion_tokens: int(u.completionTokens),
    p_total_tokens: int(u.totalTokens),
    p_audio_seconds: u.audioSeconds ?? null,
    p_latency_ms: int(u.latencyMs),
    p_outcome: u.outcome,
    p_error_code: u.errorCode ?? null,
    p_remaining_requests: int(u.remainingRequests),
    p_remaining_tokens: int(u.remainingTokens),
  });
  if (error) console.warn(`[ai] usage not recorded (run migration 0023?): ${error.message}`);
}

export type Quota = {
  provider: ProviderId;
  requests: number;
  tokens: number;
  audioSeconds: number;
  /** Highest share of any configured daily limit used today, 0–1+. */
  share: number;
  /** True when calls must stop until the provider's day resets. */
  paused: boolean;
};

export async function quota(supabase: SupabaseClient, provider: ProviderId): Promise<Quota> {
  const lim = providerLimits(provider);
  const since = dayStart(lim.resetTimeZone);
  const { data, error } = await supabase.rpc("ai_usage_totals", {
    p_provider: provider,
    p_since: since.toISOString(),
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { requests: number; tokens: number; audio_seconds: number }
    | undefined;
  if (error || !row) {
    if (error) console.warn(`[ai] quota unknown (run migration 0023?): ${error.message}`);
    return { provider, requests: 0, tokens: 0, audioSeconds: 0, share: 0, paused: false };
  }
  const requests = Number(row.requests) || 0;
  const tokens = Number(row.tokens) || 0;
  const audioSeconds = Number(row.audio_seconds) || 0;
  const ratio = (used: number, limit: number | null) => (limit ? used / limit : 0);
  const share = Math.max(
    ratio(requests, lim.requestsPerDay),
    ratio(tokens, lim.tokensPerDay),
    ratio(audioSeconds, lim.audioSecondsPerDay)
  );
  return { provider, requests, tokens, audioSeconds, share, paused: share >= guardThreshold() };
}
