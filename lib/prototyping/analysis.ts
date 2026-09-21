// The brief-analysis contract, shared by the server route, every provider and
// the client. Types and pure helpers only — the zod schema that enforces this
// shape lives in ./analysis-schema (server-only, so zod stays out of the
// browser bundle).
//
// There is deliberately no confidence anywhere in this contract: a percentage
// implies a measurement no provider is making.

import type { Discipline } from "./constants";

export type FactSource = "brief" | "assumed";

export type Requirement = { id: string; label: string; value: string; source: FactSource };

export type QuestionType = "number" | "select" | "boolean";

export type Question = { id: string; label: string; type: QuestionType; options?: string[] };

export type SuggestedPart = { name: string; kind: Discipline; note: string };

export type Analysis = {
  /** One plain-language paragraph. Empty when the provider cannot summarise. */
  summary: string;
  disciplines: Discipline[];
  requirements: Requirement[];
  questions: Question[];
  suggestedParts: SuggestedPart[];
};

/** What the client already decided; a provider treats these as settled. */
export type Answer = { id: string; label: string; value: string | null };

export type AnalysisRequest = { brief: string; answers: Answer[]; locale: "en" | "ar" };

export const ANALYSIS_STEPS = ["reading", "disciplines", "requirements", "gaps"] as const;
export type AnalysisStep = (typeof ANALYSIS_STEPS)[number];

/** Why the basic reader was used instead of the configured provider. */
export type FallbackReason = "missing_key" | "rate_limited" | "malformed" | "unavailable";

/** One line of the /api/analyse NDJSON stream. */
export type AnalysisEvent =
  | { type: "step"; step: AnalysisStep }
  | { type: "result"; analysis: Analysis; provider: string; fallback: FallbackReason | null }
  | { type: "error" };

// ── Standard facts ─────────────────────────────────────────────────────────
// Four things every physical product needs settled. Whatever a provider
// returns, each of these ends up either as a fact with a valid value or as a
// question the client answers with a real control.

export const STANDARD_FACTS = {
  quantity: { type: "number" },
  power: { type: "select", options: ["mains", "battery", "solar"] },
  mounting: { type: "select", options: ["fixed", "portable"] },
  environment: { type: "select", options: ["indoor", "outdoor", "both"] },
} as const satisfies Record<string, { type: QuestionType; options?: readonly string[] }>;

export type StandardFact = keyof typeof STANDARD_FACTS;

export const isStandardFact = (id: string): id is StandardFact => id in STANDARD_FACTS;

/** A standard fact's value is only usable if it is one of its options. */
function validStandardValue(id: StandardFact, value: string): boolean {
  const f = STANDARD_FACTS[id];
  if (f.type === "number") return /^\d+$/.test(value.trim()) && Number(value) > 0;
  return (f.options as readonly string[]).includes(value);
}

/**
 * Normalise any provider's output: an invalid standard value becomes a
 * question, every standard fact that is neither known nor asked is asked, and
 * no question duplicates a known fact.
 */
export function withStandardGaps(a: Analysis): Analysis {
  const requirements: Requirement[] = [];
  const questions = [...a.questions];
  for (const r of a.requirements) {
    if (isStandardFact(r.id) && !validStandardValue(r.id, r.value)) continue;
    requirements.push(isStandardFact(r.id) ? { ...r, value: r.value.trim() } : r);
  }
  const known = new Set(requirements.map((r) => r.id));
  for (const id of Object.keys(STANDARD_FACTS) as StandardFact[]) {
    if (known.has(id) || questions.some((q) => q.id === id)) continue;
    const f = STANDARD_FACTS[id];
    questions.push({ id, label: id, type: f.type, options: "options" in f ? [...f.options] : undefined });
  }
  return {
    ...a,
    requirements,
    // Standard questions always use our own type and options, whatever came back.
    questions: questions
      .filter((q) => !known.has(q.id))
      .map((q) => {
        if (!isStandardFact(q.id)) return q;
        const f = STANDARD_FACTS[q.id];
        return { ...q, type: f.type, options: "options" in f ? [...f.options] : undefined };
      }),
  };
}
