// The vision calls one press of "see my product" may spend. Pure, no imports,
// so the worker loop, the route's zod body and the tests share one rule.
//
// "Max 2 loops, best kept" (docs/STUDIO_PRODUCT.md) was read as a budget for
// each design, and a press designs up to three archetypes: three first checks
// plus two refinement loops each = NINE vision calls per button, on top of the
// designer call. Six of those nine refined designs the client was never going
// to unlock — only one design is ever made.
//
// So the budget belongs to the press. Every design is still checked once (the
// score is what tells us how it turned out, and it is what the Engineer view
// shows), and the refinement loops are a small pool the press shares. Designs
// are built in archetype-ranking order (rankArchetypes), so the pool is spent
// on the strongest candidate that needs help rather than split three ways, and
// nothing about "keep the best" changes: a design still keeps its own
// best-scoring version, there are simply fewer versions to choose between.

/** Refinement loops one press may spend, on top of one check per design. */
export const MAX_REFINEMENTS = 2;

export type VisionBudget = {
  /** Refinement loops still unspent. 0 means the next check is a design's last. */
  readonly left: number;
  /** Takes one loop; false when the press has spent them all. */
  take(): boolean;
};

export function visionBudget(refinements: number = MAX_REFINEMENTS): VisionBudget {
  let left = Math.max(0, Math.round(refinements));
  return {
    get left() {
      return left;
    },
    take() {
      if (left <= 0) return false;
      left -= 1;
      return true;
    },
  };
}

/** The most vision calls a press of `designs` designs can cost. */
export function maxVisionCalls(designs: number, refinements: number = MAX_REFINEMENTS): number {
  return Math.max(0, Math.round(designs)) + Math.max(0, Math.round(refinements));
}
