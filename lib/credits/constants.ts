// AI credits — the numbers and shapes shared by server and browser.
// The rules themselves live in Postgres (migration 0042); these mirror them
// for labels only. Change a rule there first, then here.

export const CREDIT_QAR = 20;
/** What one AI call is worth in QAR. Always equals the credit price (one call = one credit). Used as the default for store_settings.ai_pricing.per_call_qar (0050). */
export const AI_PRICE_QAR = CREDIT_QAR;
export const REDEEM_DAYS = 30;
export const PROJECT_LIMIT = 3;
/** Generations/refinements included in one CAD session (1 cad credit). */
export const CAD_GENERATIONS = 3;
/** Credits added once when a store order is marked delivered (0042 trigger). */
export const ORDER_DELIVERED_CREDITS = { wiring: 3, cad: 1 } as const;

export type CreditKind = "wiring" | "cad";
export type AiStep = "bom" | "wiring" | "cad";
export type AiRole = "anonymous" | "user" | "admin";

export type CanUse = {
  allowed: boolean;
  reason: "sign_in" | "no_credits" | "not_found" | "bad_step" | "not_ready" | null;
  /** none = not charged (bom, admin); credit = 1 credit; included = cad regen. No step is free except bom. */
  cost: "none" | "credit" | "included" | null;
  role: AiRole;
  balance?: number;
  regens?: number;
};

/** What credit_can_use may still answer before migration 0052 runs: 0042 called a project's first circuit "free". */
export type RawCanUse = Omit<CanUse, "cost"> & { cost: CanUse["cost"] | "free" };

/**
 * Owner rule (2026-10-09, migration 0052): the parts list is the only free AI
 * step; every circuit costs 1 wiring credit, the first one on a project too.
 * Before 0052 runs, credit_can_use still answers cost "free" for a project's
 * first circuit: treat that as a paid circuit (allowed only with a credit).
 */
export function noFreeCircuit(c: RawCanUse): CanUse {
  if (c.cost !== "free") return c as CanUse;
  const balance = c.balance ?? 0;
  return balance >= 1
    ? { ...c, allowed: true, reason: null, cost: "credit", balance }
    : { ...c, allowed: false, reason: "no_credits", cost: "credit", balance };
}

export type CreditSummary = {
  role: AiRole;
  wiring: number;
  cad: number;
  redeemable_count: number;
  redeemable_qar: number;
  next_expiry: string | null;
  active_projects: number;
  project_limit: number | null;
  credit_qar: number;
};

/** Fired on window after anything that may change a balance. */
export const CREDITS_CHANGED = "credits:changed";
