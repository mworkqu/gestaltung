// What a 3D model costs, and the loyalty rewards. Pure.
//
// ONE SOURCE OF TRUTH (F-002, owner 2026-10-24): the published price is the
// contract — under Qatar consumer-protection rules the price shown is the price
// charged. /pricing, the home page and the FAQ all publish "1 credit, up to
// CAD_GENERATIONS versions of the same model", so PUBLISHED_CAD_CREDITS below is
// the only number that may reach a button label OR a spend. Before this, the
// Studio button read a TS complexity table (1/2/3) while Postgres spent what
// migration 0090's cad_tier_cost() decided from the tier the route passed, so a
// label of 2 and a spend of 2 were published as 1.
//
// CAD credits are separate from ideation tokens, so a build can mix levels:
// Makers-level electronics (ideation tokens) with a simple case (1 CAD credit).
//
// The complexity rule of 0090 stays in the database (it is applied; nothing here
// edits it) but is now unreachable: every caller hands cad_begin CAD_CHARGE_TIER,
// the one tier whose cad_tier_cost() equals the published price.

import type { CadTier } from "./classify";
import type { CanUse } from "./constants";

/**
 * The published price of one CAD session (a 3D model, CAD_GENERATIONS versions
 * included). Label, spend and published copy all derive from this.
 * Raising it is a price change: the EN/AR copy must be changed in the same step.
 */
export const PUBLISHED_CAD_CREDITS = 1;

/** Mirror of migration 0090's cad_tier_cost(): the credits Postgres spends for a tier. Read-only here. */
export const SQL_CAD_TIER_COST: Record<CadTier, number> = { simple: 1, standard: 2, complex: 3 };

/** Inverse of cad_tier_cost(): the tier to hand cad_begin so Postgres spends exactly `credits`. */
export function cadTierForCost(credits: number): CadTier {
  if (credits >= SQL_CAD_TIER_COST.complex) return "complex";
  if (credits >= SQL_CAD_TIER_COST.standard) return "standard";
  return "simple";
}

/** The tier every cad_begin caller passes, so the spend equals the published price. */
export const CAD_CHARGE_TIER: CadTier = cadTierForCost(PUBLISHED_CAD_CREDITS);

/**
 * The one answer for a CAD session: the number the button shows AND the tier the
 * route hands cad_begin, so a label and a spend cannot differ.
 * `cost` is credit_can_use's answer: "included" is a version inside the paid
 * session (CAD_GENERATIONS per credit) and "none" is admin or a free step —
 * neither spends, so neither is priced.
 */
export function cadSessionCharge(cost: CanUse["cost"] | null | undefined): {
  credits: number;
  tier: CadTier;
} {
  const free = cost === "included" || cost === "none";
  return { credits: free ? 0 : PUBLISHED_CAD_CREDITS, tier: CAD_CHARGE_TIER };
}

/** Loyalty rebates (not refunds): defaults of store_settings 'rewards'. */
export const REWARDS_DEFAULT = {
  /** Ideation tokens back on every delivered parts order. */
  order_idea_tokens: 2,
  /** CAD credits for every completed printed-STL order (admin marks it from the lead). */
  print_cad_credits: 1,
} as const;
