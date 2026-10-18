// CAD credits scaled by complexity + loyalty rewards (owner, 2026-10-18). Pure.
//
// CAD credits are separate from ideation tokens, so a build can mix levels:
// Makers-level electronics (ideation tokens) with a simple case (1 CAD credit).
//
// CAD_CREDIT_COST is mirrored in migration 0090's cad_tier_cost() — change
// both. The rewards defaults are mirrored there too and can be changed without
// a deploy in store_settings row 'rewards' ({order_idea_tokens, print_cad_credits}).

import type { CadTier } from "./classify";

/** CAD credits per new CAD session, by complexity. Regenerations inside a session stay included. */
export const CAD_CREDIT_COST: Record<CadTier, number> = { simple: 1, standard: 2, complex: 3 };

/** Studio builds: complexity from how many parts the case has to hold (components incl. helper parts). */
export const STUDIO_CAD_TIERS = { simpleMaxParts: 8, standardMaxParts: 16 } as const;

export function studioCadTier(componentCount: number): CadTier {
  if (componentCount <= STUDIO_CAD_TIERS.simpleMaxParts) return "simple";
  if (componentCount <= STUDIO_CAD_TIERS.standardMaxParts) return "standard";
  return "complex";
}

export const cadCost = (tier: CadTier) => CAD_CREDIT_COST[tier];

/** Loyalty rebates (not refunds): defaults of store_settings 'rewards'. */
export const REWARDS_DEFAULT = {
  /** Ideation tokens back on every delivered parts order. */
  order_idea_tokens: 2,
  /** CAD credits for every completed printed-STL order (admin marks it from the lead). */
  print_cad_credits: 1,
} as const;
