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

export type CreditKind = "wiring" | "cad";
export type AiStep = "bom" | "wiring" | "cad";
export type AiRole = "anonymous" | "user" | "admin";

export type CanUse = {
  allowed: boolean;
  reason: "sign_in" | "no_credits" | "not_found" | "bad_step" | "not_ready" | null;
  /** none = not charged (bom, admin); free = first wiring; credit = 1 credit; included = cad regen */
  cost: "none" | "free" | "credit" | "included" | null;
  role: AiRole;
  balance?: number;
  regens?: number;
};

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
