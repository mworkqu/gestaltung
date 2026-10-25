// Ideation tokens — server side (migration 0088). Server-only.
//
// The spec route asks ideaStatus() before a chat turn that will reach the
// model and ideaCharge() after it answered. Amounts come from
// lib/studio/tiers.ts; the SQL functions only move tokens (never add any) and
// never charge an admin. Until 0088 runs both answer null and the chat stays
// free and unmetered (a warning in the server console), like credits/server.ts.
//
// 2026-10-25: an idea is paid for UPFRONT at its tier and refining it is always
// free, so the only charges are a new idea, an APPROVED tier escalation and an
// APPROVED switch to a different product (chargePlan() in tiers.ts decides which).
// Each is single-shot: an escalation because a charge raises idea_sessions.tier and
// a plan only charges when the tier would RISE, a new product because its claim row
// carries the idea's identity key, unique per project (0106). claimCharge() writes
// the agreed amount before the tokens move and fillCharge() records what the model
// really consumed beside it.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CallSpend } from "@/lib/prototyping/ai-call";
import { stableHash } from "../cache";
import { ideaKey, newIdeaTurn } from "../identity";
import type { ProductSpec } from "../schema";
import { IDEATION, chargePlan, tierOf, tierRank, turnsUntilCharge, type ChargePlan, type Tier, type TierId, type TierReason } from "../tiers";
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

/**
 * Charge a plan, once. `plan.amount` is derived from the tiers server-side; nothing
 * about the money comes from the request body. `edit` is false: an upfront charge is
 * not an edit turn (edits are free and are never counted against a token).
 */
export async function applyChargePlan(supabase: SupabaseClient, projectId: string, plan: ChargePlan): Promise<IdeaCharge | null> {
  return ideaCharge(supabase, projectId, plan.amount, plan.tier.id, false);
}

/**
 * Take the agreed amount and write the telemetry around it, in the one order that
 * keeps both honest:
 *
 *   1. claim  — the quote goes down BEFORE a token moves, and for a "different
 *               product" charge the claim is also the replay guard: no row means
 *               this project already paid for this idea, so nothing is charged;
 *   2. charge — idea_token_charge takes exactly that amount (0 at Tier 1, 0 for an
 *               admin) and records the tier the next turn is priced against;
 *   3. fill   — what was really taken, beside what the model really consumed.
 *
 * `charge` is null when there is nothing to do (a free refinement) or when 0088 is
 * not applied; `{ok: false}` is passed back for the route to answer with.
 */
export async function settleCharge(
  supabase: SupabaseClient,
  projectId: string,
  plan: ChargePlan,
  opts: {
    /** Null outside a signed-in, metered turn: then nothing is charged or recorded. */
    status: IdeaStatus | null;
    /** Identity key of the new idea ("new_product" charges only), the replay guard. */
    ideaKey?: string | null;
    spend?: CallSpend | null;
    model?: string | null;
    source?: "model" | "default" | "cache" | "rules";
  },
): Promise<{ charge: IdeaCharge | null; charged: number }> {
  if (!opts.status) return { charge: null, charged: 0 };
  // Every priced decision is recorded, including the free ones (a Tier 1 idea, an
  // admin's turn): that is what makes the report "what we quoted vs what it cost us".
  const claim = plan.kind === "none" ? null : await claimCharge(supabase, projectId, plan, opts.ideaKey);
  // A claim that came back without a row: already paid for, so this turn is free.
  const amount = claim && claim.id === null ? 0 : plan.amount;
  // The first turn of a project still writes the session row (the tier floor), free or not.
  const charge = amount > 0 || plan.kind === "new_idea" ? await applyChargePlan(supabase, projectId, { ...plan, amount }) : null;
  const charged = charge?.ok ? charge.charged : 0;
  if (claim?.id) {
    await fillCharge(supabase, claim.id, { charged, spend: opts.spend, model: opts.model, source: opts.source });
  }
  return { charge, charged };
}

/**
 * Step 1 of a charge (migration 0106): write down what the visitor agreed to, before
 * a token moves. For a turn that starts a DIFFERENT product the row also carries the
 * idea's identity key, which is unique per project — so the answer tells the caller
 * whether this is the first time:
 *
 *   {ok: true, id}        charge now, then fill the row in;
 *   {ok: true, id: null}  this project already paid for this idea: charge NOTHING;
 *   null                  0106 is not applied (or the write failed) — charge anyway,
 *                         because telemetry must never block the product.
 *
 * With stage "quoted" it instead records that the checkpoint was SHOWN at that price
 * (quoteTurn below); the caller ignores the answer and charges nothing.
 */
export async function claimCharge(
  supabase: SupabaseClient,
  projectId: string,
  plan: ChargePlan,
  ideaKey?: string | null,
  stage: "quoted" | "charged" = "charged",
): Promise<{ ok: true; id: string | null } | null> {
  const { data, error } = await supabase.rpc("idea_charge_claim", {
    p_project: projectId,
    p_kind: plan.kind === "none" ? "new_idea" : plan.kind,
    p_from_tier: plan.from.id,
    p_to_tier: plan.tier.id,
    p_estimated: plan.amount,
    p_idea_key: ideaKey ?? null,
    p_stage: stage,
  });
  if (error) {
    if (missing(error)) console.warn("[tokens] idea_charge_claim missing — run migration 0106. Charges are not recorded until then.");
    else console.warn(`[tokens] charge claim on ${projectId} failed: ${error.message}`);
    return null;
  }
  return { ok: true, id: (data as string | null) ?? null };
}

/**
 * Step 2: what really happened. `charged` is the agreed amount that was taken (0 for
 * an admin) and `spend` is what the model consumed on that turn — recorded beside each
 * other, never billed against each other (the fixed upfront agreement). Best-effort:
 * the tokens have already moved, so a telemetry failure only warns.
 */
export async function fillCharge(
  supabase: SupabaseClient,
  rowId: string,
  opts: {
    charged: number;
    spend?: CallSpend | null;
    model?: string | null;
    /** Where the answer came from: the model, a safe default, the cache or our own rules. */
    source?: "model" | "default" | "cache" | "rules";
  },
): Promise<void> {
  const { error } = await supabase.rpc("idea_charge_fill", {
    p_id: rowId,
    p_charged: opts.charged,
    p_prompt_tokens: opts.spend?.promptTokens ?? 0,
    p_completion_tokens: opts.spend?.completionTokens ?? 0,
    p_cost_usd: opts.spend?.costUsd ?? null,
    p_model: opts.model ?? null,
    p_source: opts.source ?? null,
  });
  if (error && !missing(error)) console.warn(`[tokens] telemetry for ${rowId} not completed: ${error.message}`);
}

/**
 * The tier checkpoint the chat has to show before anything is charged: the target
 * tier and the EXACT cost. The UI either gets a yes (and sends approveTier back) or
 * stays in the current tier with the scope kept simple.
 */
export type ApprovalAsk = {
  /** new_product = the message starts a different product, charged as a new idea. */
  kind: "new_idea" | "escalation" | "new_product";
  fromTier: TierId;
  fromLevel: number;
  tier: TierId;
  level: number;
  /** Exactly what will be charged on approval. */
  tokens: number;
  balance: number | null;
  /** Why the build is above Tier 1 (message key Studio.tierWhy_<code>). */
  reasons: TierReason[];
};

export function approvalAsk(plan: ChargePlan, status: IdeaStatus | null): ApprovalAsk {
  return {
    kind: plan.kind === "none" ? "new_idea" : plan.kind,
    fromTier: plan.from.id,
    fromLevel: plan.from.level,
    tier: plan.tier.id,
    level: plan.tier.level,
    tokens: plan.amount,
    balance: status?.balance ?? null,
    reasons: plan.reasons,
  };
}

/**
 * The checkpoint was shown at this price and the visitor has not answered yet
 * (0106, stage 'quoted'). Recorded so the owner can see how often a price is
 * declined or walked away from, and at what price — quoted minus charged. Keyed by
 * the quote itself, so showing the same checkpoint again writes nothing, and the key
 * is prefixed so it can never be mistaken for the charge's own single-shot key.
 * Nothing is charged here, and a failure only warns.
 */
async function quoteTurn(
  supabase: SupabaseClient,
  projectId: string,
  plan: ChargePlan,
  after: ProductSpec | null,
): Promise<void> {
  const key = `q:${stableHash({ kind: plan.kind, from: plan.from.id, to: plan.tier.id, idea: ideaKey(after) })}`;
  await claimCharge(supabase, projectId, plan, key.slice(0, 64), "quoted");
}

/**
 * What this turn is, in money terms. The identity check runs here so the route never
 * has to reason about it: both the model's own hint and our reading of the identity
 * fields must agree before a turn is treated as a different product (identity.ts),
 * and everything else is a refinement of the same idea, which is free.
 */
export function planTurn(opts: {
  status: IdeaStatus | null;
  /** The card shown before this turn. */
  before: ProductSpec | null;
  /** The card this turn produced (null = the card did not change). */
  produced: ProductSpec | null;
  /** The model's "this message replaces the product" hint, if it gave one. */
  hint?: boolean;
  /** The tier the visitor approved in the checkpoint modal. */
  approved?: string | null;
}): ChargePlan {
  const identity = newIdeaTurn({ before: opts.before, after: opts.produced, hint: opts.hint });
  return chargePlan({
    storedTier: opts.status?.tier,
    started: Boolean(opts.status?.started),
    spec: opts.produced ?? opts.before,
    approved: opts.approved,
    admin: opts.status?.role === "admin",
    newIdea: identity.newIdea,
  });
}

/**
 * The whole money side of one chat turn, so the route stays parse / guard / call /
 * respond:
 *
 *   {ok: true}   nothing to pay, or the agreed amount was taken;
 *   {pause}      the tier checkpoint — the UI shows the exact cost and either sends
 *                the turn again with approveTier, or keeps refining what it has.
 *                Nothing was charged and the new card must NOT be handed over;
 *   {refused}    too few tokens (402) or the charge itself failed (409).
 *
 * `before` is the card as the visitor already sees it: while a charge is pending the
 * balance line keeps showing the tier they are still on, never the one they have not
 * approved.
 */
export type TurnMoney =
  | { ok: true; tokens: TokenInfo; refused?: undefined; pause?: undefined }
  | { ok: false; refused: { status: number; body: Record<string, unknown> }; pause?: undefined }
  | { ok: false; pause: { needsApproval: ApprovalAsk; tokens: TokenInfo }; refused?: undefined };

export async function priceTurn(
  supabase: SupabaseClient,
  projectId: string,
  plan: ChargePlan,
  opts: {
    /** Null when the turn never reached the model (our own rules answered it): always free. */
    status: IdeaStatus | null;
    /** The card shown before this turn. */
    before: ProductSpec | null;
    /** The card this turn produced or kept. */
    after: ProductSpec | null;
    /** The card's tier before this turn, for the "moved tier" flag. */
    previousTier?: Tier;
    spend?: CallSpend | null;
    model?: string | null;
    source?: "model" | "default" | "cache" | "rules";
  },
): Promise<TurnMoney> {
  const { status } = opts;
  const pending = { status, spec: opts.before, tier: plan.from };
  if (!status) return { ok: true, tokens: tokenInfo({ status, spec: opts.after, before: opts.previousTier }) };
  if (plan.amount > status.balance && status.role !== "admin") {
    return { ok: false, refused: { status: 402, body: { error: "no_tokens", need: plan.amount, tokens: tokenInfo(pending) } } };
  }
  if (plan.needsApproval) {
    await quoteTurn(supabase, projectId, plan, opts.after);
    return { ok: false, pause: { needsApproval: approvalAsk(plan, status), tokens: tokenInfo(pending) } };
  }

  // A "different product" charge is keyed by the new idea's identity, so an approval
  // replayed by a double click or a retry claims nothing and charges nothing.
  const key = plan.kind === "new_product" ? ideaKey(opts.after) : null;
  const { charge } = await settleCharge(supabase, projectId, plan, { ...opts, ideaKey: key });
  if (charge && !charge.ok) {
    return {
      ok: false,
      refused: {
        status: charge.error === "no_tokens" ? 402 : 409,
        body: { error: charge.error, need: plan.amount, tokens: tokenInfo(pending) },
      },
    };
  }
  return { ok: true, tokens: tokenInfo({ status, charge, spec: opts.after, before: opts.previousTier, tier: plan.tier }) };
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
  /** The owner's 1 / 2 / 3 numbering of `tier`. */
  level: 1 | 2 | 3;
  /** Tokens an idea at this tier is charged upfront (0 at Tier 1). */
  upfront: number;
  /** Maker Pass end date (ISO) when active. */
  passUntil?: string | null;
};

export function tokenInfo(opts: {
  status: IdeaStatus | null;
  charge?: IdeaCharge | null;
  spec: ProductSpec | null;
  before?: Tier;
  /** The tier the SERVER is pricing the project at; beats the card's own tier (AI-06). */
  tier?: Tier;
}): TokenInfo {
  // The route passes the tier it priced the turn at, so an unapproved escalation
  // never shows the higher tier in the balance line.
  const tier = opts.tier ?? tierOf(opts.spec);
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
    level: tier.level,
    upfront: tier.upfront,
    multiplier: tier.multiplier,
    turnsPerToken: IDEATION.turnsPerToken,
    nextChargeIn: turnsUntilCharge(editTurns),
    passUntil: opts.status?.pass_until ?? null,
    ...(change ? { tierChange: change } : {}),
  };
}
