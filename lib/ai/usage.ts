// AI metering and the daily guard. Server-only.
//
// logUsage() writes one ai_usage row per provider call (migration 0023) —
// what it cost, how long it took, how it ended. quota() answers "may we call
// this provider right now?" from today's rows and lib/ai/limits.
//
// Logging is server-only since migration 0101 (audit DB-02): the row is
// written with the service-role client through log_ai_usage_server, with the
// user id verified by auth.getUser() on the caller's session (a browser can no
// longer call log_ai_usage and inflate the totals). Before 0101 runs (no
// log_ai_usage_server) it falls back to the old log_ai_usage on the caller's
// session. Without a service key it warns once and skips the row — metering
// is best-effort: a failed log never fails the user's call (it only warns),
// but nothing is counted towards the daily guard while rows are skipped.
//
// quota() still reads ai_usage_totals with the caller's own session (every
// AI route requires one). If 0023 has not run yet, the guard lets calls
// through (there is nothing to count), rather than breaking the feature.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { dayStart, guardThreshold, providerLimits, type ProviderId } from "./limits";
import { callCostUsd } from "./prices";
import { isMissingFunction } from "@/lib/supabase/errors";

// "studio" (Design Studio, 0068): until 0068 runs the ai_usage check constraint
// rejects it — logUsage only warns, so the user's call is never affected.
export type Feature = "analyse" | "netlist" | "transcribe" | "electronics" | "firmware" | "cad" | "studio" | "billing";

export type UsageRow = {
  /** The caller's id, already verified by the route with auth.getUser(). When
   *  absent (older callers) logUsage looks it up once on `supabase`. */
  userId?: string | null;
  provider: ProviderId;
  model?: string | null;
  projectId?: string | null;
  feature: Feature;
  /** Sub-step within a feature (e.g. studio: spec | pick | enclosure | mech). Stored in
   *  ai_usage.step from migration 0088 on; before that, the server console line only. */
  step?: string | null;
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
    `[ai] ${u.feature}${u.step ? `/${u.step}` : ""} ${u.provider}${u.model ? ` (${u.model})` : ""} ${u.outcome}${
      u.errorCode ? `:${u.errorCode}` : ""
    } tokens in=${u.promptTokens ?? "-"} out=${u.completionTokens ?? "-"} total=${u.totalTokens ?? "-"}${
      u.audioSeconds != null ? ` audio=${u.audioSeconds}s` : ""
    } ${u.latencyMs ?? "-"}ms${u.remainingRequests != null ? ` remaining-requests=${u.remainingRequests}` : ""}`
  );
  const int = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  const args: UsageArgs = {
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
  };
  // 0088: step + what the call cost at the paid list price (lib/ai/prices.ts).
  const cost = u.outcome === "blocked" ? 0 : callCostUsd(u);
  await recordUsage(supabase, args, { p_step: u.step ?? null, p_cost_usd: cost }, u.userId);
}

/** The 13 arguments every log_ai_usage form takes. */
export type UsageArgs = {
  p_provider: string;
  p_model: string | null;
  p_project: string | null;
  p_feature: string;
  p_prompt_tokens: number | null;
  p_completion_tokens: number | null;
  p_total_tokens: number | null;
  p_audio_seconds: number | null;
  p_latency_ms: number | null;
  p_outcome: "ok" | "error" | "blocked";
  p_error_code: string | null;
  p_remaining_requests: number | null;
  p_remaining_tokens: number | null;
};

type RpcError = { code?: string; message?: string } | null;
const fnMissing = (e: RpcError) => !!e && (isMissingFunction(e) || /could not find the function/i.test(e.message ?? ""));

// Fallback for callers that do not pass the verified id: one auth.getUser() per
// session client. Only a found id is cached — a failed lookup is retried.
const sessionUsers = new WeakMap<object, string>();
async function sessionUserId(supabase: SupabaseClient): Promise<string | null> {
  const known = sessionUsers.get(supabase);
  if (known) return known;
  const id = await supabase.auth.getUser().then(
    (r) => r.data.user?.id ?? null,
    () => null,
  );
  if (id) sessionUsers.set(supabase, id);
  return id;
}

let warnedNoService = false;

/**
 * One ai_usage row. `supabase` is the caller's session (it identifies the user);
 * the row itself is written with the service client (0101). Never throws.
 */
export async function recordUsage(
  supabase: SupabaseClient,
  args: UsageArgs,
  extra: { p_step: string | null; p_cost_usd: number | null },
  verifiedUserId?: string | null,
): Promise<void> {
  const service = createServiceClient();
  if (!service) {
    if (!warnedNoService) {
      warnedNoService = true;
      console.warn("[ai] usage not recorded: SUPABASE_SERVICE_ROLE_KEY is not set (AI usage is logged server-side only)");
    }
    return;
  }
  const userId = verifiedUserId || (await sessionUserId(supabase));
  if (!userId) {
    console.warn("[ai] usage not recorded: no signed-in session");
    return;
  }
  const { error } = await service.rpc("log_ai_usage_server", { p_user: userId, ...args, ...extra });
  if (!error) return;
  if (!fnMissing(error)) {
    console.warn(`[ai] usage not recorded: ${error.message}`);
    return;
  }

  // Before 0101: the old forms on the caller's session (15 args from 0088, else 13).
  let { error: legacy } = await supabase.rpc("log_ai_usage", { ...args, ...extra });
  if (fnMissing(legacy)) ({ error: legacy } = await supabase.rpc("log_ai_usage", args));
  if (legacy) console.warn(`[ai] usage not recorded (run migration 0023?): ${legacy.message}`);
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
