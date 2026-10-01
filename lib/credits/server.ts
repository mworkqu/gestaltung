// AI access and credits — server side. Every AI route asks canUse() before it
// calls a model and spend() after a successful result. The rules run in
// Postgres (migration 0042, SECURITY DEFINER functions), so the browser can
// never grant itself a step or a credit; these are thin, typed wrappers.
//
// Until 0042 runs, the functions do not exist: canUse() and bomRate() then let
// the call through (today's behaviour) and spend() is a no-op, with a warning
// in the server console — the feature keeps working, it just isn't metered.

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiStep, CanUse } from "./constants";

type RpcError = { code?: string; message?: string } | null;

/** The function does not exist yet (0042 not run). */
const missing = (e: RpcError) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

export async function canUse(supabase: SupabaseClient, step: AiStep, projectId: string | null): Promise<CanUse> {
  const { data, error } = await supabase.rpc("credit_can_use", { p_step: step, p_project: projectId });
  if (error) {
    if (missing(error)) {
      console.warn("[credits] credit_can_use missing — run migration 0042. Allowing.");
      return { allowed: true, reason: null, cost: "none", role: "user" };
    }
    console.error("[credits] credit_can_use failed:", error.message);
    return { allowed: false, reason: "not_ready", cost: null, role: "anonymous" };
  }
  return data as CanUse;
}

export type SpendResult =
  | { ok: true; charged: boolean; cost: CanUse["cost"]; balance: number | null }
  | { ok: false; error: "sign_in" | "no_credits" | "not_found" | "failed" };

export async function spend(supabase: SupabaseClient, step: "wiring" | "cad", projectId: string): Promise<SpendResult> {
  const { data, error } = await supabase.rpc("spend_credit", { p_step: step, p_project: projectId });
  if (error) {
    if (missing(error)) return { ok: true, charged: false, cost: "none", balance: null };
    const code = (["sign_in", "no_credits", "not_found"] as const).find((c) => error.message?.includes(c));
    console.error(`[credits] spend ${step} on ${projectId} failed:`, error.message);
    return { ok: false, error: code ?? "failed" };
  }
  const d = data as { charged: boolean; cost: CanUse["cost"]; balance: number | null };
  return { ok: true, charged: d.charged, cost: d.cost, balance: d.balance };
}

/** The caller's IP, hashed with a server secret — never stored in the clear. */
function ipHash(request: Request): string | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  if (!ip) return null;
  const salt = process.env.AI_RATE_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "gestaltung-rate";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export type RateResult = { allowed: boolean; used: number; limit: number | null };

/** Counts one BOM run against today's allowance (anonymous 5, user 30, admin ∞). */
export async function bomRate(supabase: SupabaseClient, request: Request): Promise<RateResult> {
  // TODO(turnstile): verify a Cloudflare Turnstile token here for anonymous callers.
  const { data, error } = await supabase.rpc("bom_rate_check", { p_ip_hash: ipHash(request) });
  if (error) {
    if (!missing(error)) console.error("[credits] bom_rate_check failed:", error.message);
    else console.warn("[credits] bom_rate_check missing — run migration 0042. Allowing.");
    return { allowed: true, used: 0, limit: null };
  }
  const d = data as { allowed: boolean; used: number; limit: number | null };
  return { allowed: d.allowed, used: d.used, limit: d.limit };
}
