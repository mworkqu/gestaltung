// Ideation tokens — server side (migration 0088). Server-only.
//
// The spec route asks ideaStatus() before a chat turn that will reach the
// model and ideaCharge() after it answered. Amounts come from
// lib/studio/tiers.ts; the SQL functions only move tokens (never add any) and
// never charge an admin. Until 0088 runs both answer null and the chat stays
// free and unmetered (a warning in the server console), like credits/server.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductSpec } from "../schema";
import { IDEATION, tierOf, tierRank, turnsUntilCharge, type Tier, type TierId } from "../tiers";
import { isMissingFunction } from "@/lib/supabase/errors";

type RpcError = { code?: string; message?: string } | null;
const missing = (e: RpcError) =>
  !!e && (isMissingFunction(e) || e.code === "42P01" || /could not find the function/i.test(e.message ?? ""));

export type IdeaStatus = {
  role: "anonymous" | "user" | "admin";
  balance: number;
  started: boolean;
  edit_turns: number;
  tokens_used: number;
  tier: TierId;
  /** 0089: the Maker Pass end date when active. */
  pass_until?: string | null;
};

export async function ideaStatus(supabase: SupabaseClient, projectId: string | null): Promise<IdeaStatus | null> {
  const { data, error } = await supabase.rpc("idea_token_status", { p_project: projectId });
  if (error) {
    if (missing(error)) console.warn("[tokens] idea_token_status missing — run migration 0088. Chat is free until then.");
    else console.error("[tokens] idea_token_status failed:", error.message);
    return null;
  }
  return data as IdeaStatus;
}

export type IdeaCharge =
  | { ok: true; charged: number; balance: number; edit_turns: number; tokens_used: number }
  | { ok: false; error: "no_tokens" | "not_found" | "sign_in" | "failed"; balance: number };

export async function ideaCharge(
  supabase: SupabaseClient,
  projectId: string,
  amount: number,
  tier: TierId,
  edit: boolean,
): Promise<IdeaCharge | null> {
  const { data, error } = await supabase.rpc("idea_token_charge", { p_project: projectId, p_amount: amount, p_tier: tier, p_edit: edit });
  if (error) {
    if (!missing(error)) console.error(`[tokens] charge on ${projectId} failed:`, error.message);
    return missing(error) ? null : { ok: false, error: "failed", balance: 0 };
  }
  return data as IdeaCharge;
}

/** What the Studio shows next to the chat: balance, tier and when the next edit token is due. */
export type TokenInfo = {
  balance: number | null;
  admin: boolean;
  charged: number;
  tier: TierId;
  multiplier: number;
  turnsPerToken: number;
  nextChargeIn: number;
  /** Set on the turn the build moved to another tier. */
  tierChange?: "up" | "down";
  /** Maker Pass end date (ISO) when active. */
  passUntil?: string | null;
};

export function tokenInfo(opts: {
  status: IdeaStatus | null;
  charge?: IdeaCharge | null;
  spec: ProductSpec | null;
  before?: Tier;
}): TokenInfo {
  const tier = tierOf(opts.spec);
  const charged = opts.charge?.ok ? opts.charge.charged : 0;
  const editTurns = opts.charge?.ok ? opts.charge.edit_turns : (opts.status?.edit_turns ?? 0);
  const balance = opts.charge ? opts.charge.balance : (opts.status?.balance ?? null);
  const change =
    opts.before && opts.before.id !== tier.id ? (tierRank(tier.id) > tierRank(opts.before.id) ? "up" : "down") : undefined;
  return {
    balance: opts.status ? balance : null,
    admin: opts.status?.role === "admin",
    charged,
    tier: tier.id,
    multiplier: tier.multiplier,
    turnsPerToken: IDEATION.turnsPerToken,
    nextChargeIn: turnsUntilCharge(editTurns),
    passUntil: opts.status?.pass_until ?? null,
    ...(change ? { tierChange: change } : {}),
  };
}
