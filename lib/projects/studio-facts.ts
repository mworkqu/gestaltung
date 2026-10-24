// F-043: what a /projects card says about a Studio project comes from the Studio doc itself.
// The legacy tallies (project_items / project_parts) are empty for a Studio project, which
// is why a design with nine parts used to read "0 parts" and, after a quote request, "Planning".
// Pure: the page selects `studio->components` and `studio->answers` (small jsonb paths) and hands them here.

import { REQUEST_SENT_KEY } from "@/lib/studio/request-summary";

export type StudioCardFacts = {
  /** Parts in the doc's parts list (every placed instance). */
  parts: number;
  /** "Get it made" was sent (the doc carries the request:sent stamp). */
  quoteRequested: boolean;
};

export function studioCardFacts(components: unknown, answers: unknown): StudioCardFacts {
  const sent =
    answers !== null && typeof answers === "object" ? (answers as Record<string, unknown>)[REQUEST_SENT_KEY] : undefined;
  return {
    parts: Array.isArray(components) ? components.length : 0,
    quoteRequested: typeof sent === "string" && sent.length > 0,
  };
}
