// The client view's four plain steps (P5-04): Your idea, Your parts, Your
// wiring, Get it made. One page, top to bottom, one card and one button each.
//
// This works out which steps the project has and where the client is: a step
// is done, the current one (the first that is not done), or still to come.
// No percentages, no counters: the card only shows a number badge and a tick.
// Wiring is left out for a project with no electronics, so a mechanical-only
// project reads as three steps.
//
// Pure and client-safe.

export type ClientStepId = "idea" | "parts" | "wiring" | "make";
export type ClientStepStatus = "done" | "current" | "upcoming";

export type ClientStep = { id: ClientStepId; n: number; status: ClientStepStatus };

export type ClientStepFacts = {
  /** The idea was read: an analysis exists. */
  analysed: boolean;
  /** The project has parts to buy (any live BOM line). */
  hasParts: boolean;
  /** Nothing buyable is left to add: everything is in the cart or bought. */
  partsHandled: boolean;
  /** The project involves electronics, so it needs a wiring picture. */
  needsWiring: boolean;
  /** A wiring picture exists and nothing blocks it. */
  wiringDone: boolean;
};

export function deriveClientSteps(f: ClientStepFacts): ClientStep[] {
  const ids: ClientStepId[] = ["idea", "parts", ...(f.needsWiring ? (["wiring"] as const) : []), "make"];
  const done: Record<ClientStepId, boolean> = {
    idea: f.analysed,
    parts: f.analysed && f.hasParts && f.partsHandled,
    wiring: f.analysed && f.wiringDone,
    // The last step is a request, not something the page can tell was finished.
    make: false,
  };
  let currentTaken = false;
  return ids.map((id, i) => {
    let status: ClientStepStatus;
    if (done[id]) status = "done";
    else if (!currentTaken) {
      status = "current";
      currentTaken = true;
    } else status = "upcoming";
    return { id, n: i + 1, status };
  });
}

/** Whether the electronics wiring step applies: an electronics branch or electronics lines. */
export function needsWiring({ electronicsActive, hasElectronicsLines, hasNetlist }: { electronicsActive: boolean; hasElectronicsLines: boolean; hasNetlist: boolean }): boolean {
  return electronicsActive || hasElectronicsLines || hasNetlist;
}

/**
 * The wiring button's cost word, exactly per the credit rules (lib/credits):
 * every circuit costs one credit and only an admin is free. Anything unknown
 * (not signed in, still loading, old database) reads as a credit, never as free.
 */
export function wiringCostKind(access: { cost?: string | null } | null | undefined): "credit" | "free" {
  return access?.cost === "none" ? "free" : "credit";
}

/** Whether a client can see the part-choice link: only strong, non-doubtful alternatives. */
export function clientAlternatives<T extends { id: string; strength: string; doubt?: boolean }>(
  candidates: readonly T[],
  currentId: string | null | undefined
): T[] {
  return candidates.filter((c) => c.id !== currentId && c.strength === "strong" && !c.doubt);
}
