// "What we understood", as data: a spec sheet of facts plus the questions the
// analysis could not answer. Stored whole in projects.spec (migration 0022).
//
// The rule that shapes everything here: anything the client typed, edited or
// selected wins over anything an analysis returns. A re-analysis may add and
// refresh facts, but an edited row keeps the client's value and only records
// what the analysis said beside it, so the UI can show "kept your answer".

import { isStandardFact, type Analysis, type Answer, type FallbackReason, type Question, type RouteRecommendation } from "./analysis";

export type RowSource = "brief" | "assumed" | "you";

export type SpecRow = {
  id: string;
  label: string;
  /** null = the client recorded "not decided yet" (only ever on edited rows). */
  value: string | null;
  source: RowSource;
  /** Set by the client. Edited rows survive every re-analysis unchanged. */
  edited: boolean;
  /** What the latest analysis read for an edited row, when it read anything. */
  analysisValue?: string;
};

/**
 * The client's consent to send their brief to an outside analysis provider,
 * recorded the first time they analyse with one (audit #10). `destination` is
 * the provider's public name at that moment, so switching provider asks again.
 */
export type AiConsent = { at: string; destination: string };

export type Spec = {
  summary: string;
  rows: SpecRow[];
  questions: Question[];
  /** The client confirmed the facts the analysis read. */
  confirmed: boolean;
  /** Which reader produced the facts, and why the basic one was used if it was. */
  provider: string;
  fallback: FallbackReason | null;
  /**
   * When the analysis behind these facts ran. The project's own record of its
   * latest successful analysis: the 18 Oct 2026 export showed an empty
   * `analysis` block beside 24 recorded runs, because the only place the answer
   * lived was analysis_runs. Absent on specs written before this was recorded.
   */
  runAt?: string | null;
  /** The analysis's advice on how to build the electronics (advice only). */
  routeRecommendation?: RouteRecommendation | null;
  /** Set once the client agreed to send their brief to an outside provider. */
  aiConsent?: AiConsent | null;
};

/**
 * The consent on record for this project, or null. With a destination, only a
 * consent given for that same provider counts. A malformed value never counts.
 */
export function aiConsentOf(
  spec: Pick<Spec, "aiConsent"> | null | undefined,
  destination?: string | null
): AiConsent | null {
  const c = spec?.aiConsent;
  if (!c || typeof c.at !== "string" || typeof c.destination !== "string") return null;
  if (Number.isNaN(Date.parse(c.at))) return null;
  if (destination != null && c.destination !== destination) return null;
  return c;
}

/** Whether the client already agreed to send this project's brief out. */
export const hasAiConsent = (
  spec: Pick<Spec, "aiConsent"> | null | undefined,
  destination?: string | null
): boolean => aiConsentOf(spec, destination) !== null;

export const rowOf = (spec: Spec | null | undefined, id: string) =>
  spec?.rows.find((r) => r.id === id);

/** An edited value the latest analysis disagrees with. */
export const keptAnswer = (r: SpecRow) =>
  r.edited && r.analysisValue !== undefined && r.analysisValue !== r.value;

/** Rows the client decided, sent with the next analysis as settled facts. */
export const answersOf = (spec: Spec | null | undefined): Answer[] =>
  (spec?.rows ?? [])
    .filter((r) => r.edited)
    .map((r) => ({ id: r.id, label: r.label, value: r.value }));

export function mergeAnalysis(
  prev: Spec | null | undefined,
  a: Analysis,
  meta: { provider: string; fallback: FallbackReason | null; runAt?: string }
): Spec {
  const before = new Map((prev?.rows ?? []).map((r) => [r.id, r]));
  const rows: SpecRow[] = a.requirements.map((r) => {
    const p = before.get(r.id);
    if (p?.edited) return { ...p, analysisValue: r.value };
    return { id: r.id, label: r.label, value: r.value, source: r.source, edited: false };
  });
  // The client's own rows stay even when the analysis no longer mentions them.
  for (const p of prev?.rows ?? []) {
    if (p.edited && !rows.some((r) => r.id === p.id)) {
      const { analysisValue: _drop, ...kept } = p;
      void _drop;
      rows.push(kept);
    }
  }

  // Questions: the new gaps, plus any earlier question the client answered, so
  // the control they used does not vanish from under them.
  const questions = [...a.questions];
  for (const q of prev?.questions ?? []) {
    if (before.get(q.id)?.edited && !questions.some((x) => x.id === q.id)) questions.push(q);
  }

  // A confirmation covered the facts as they were. It survives only if the
  // analysis read exactly the same facts again.
  const readBefore = (prev?.rows ?? []).filter((r) => !r.edited).map((r) => `${r.id}=${r.value}`);
  const readNow = rows.filter((r) => !r.edited).map((r) => `${r.id}=${r.value}`);
  const same = readBefore.length === readNow.length && readBefore.every((x) => readNow.includes(x));

  return {
    summary: a.summary,
    rows,
    questions,
    confirmed: Boolean(prev?.confirmed) && same,
    provider: meta.provider,
    fallback: meta.fallback,
    // A reused answer keeps the time of the run it came from, so the project
    // records when its facts were actually read.
    runAt: meta.runAt ?? prev?.runAt ?? null,
    // A basic-reader run cannot advise, so it keeps the earlier advice.
    routeRecommendation: a.electronicsRoute ?? prev?.routeRecommendation ?? null,
    // Consent is the client's, not the analysis's: it survives every re-analysis.
    aiConsent: prev?.aiConsent ?? null,
  };
}

/**
 * The question still waiting for an answer, standard facts first — those are
 * the ones that block, so that is where a client who pressed Analyse again on
 * an unchanged brief is sent instead of paying for the same answer twice.
 */
export function nextOpenQuestion(spec: Spec | null | undefined): Question | null {
  const open = (spec?.questions ?? []).filter((q) => !rowOf(spec, q.id)?.edited);
  return open.find((q) => isStandardFact(q.id)) ?? open[0] ?? null;
}

/** A spec before any analysis: lets a choice (e.g. power) be saved first. */
export const EMPTY_SPEC: Spec = { summary: "", rows: [], questions: [], confirmed: false, provider: "", fallback: null };

/**
 * True once a reader has filled the spec. A spec holding only the AI consent
 * (a project started from the chat, P1-11 / CC-1, or the chat's own consent)
 * has not been analysed yet.
 */
export function isAnalysed(spec: Spec | null | undefined): spec is Spec {
  return !!spec && (Boolean(spec.provider) || spec.rows.length > 0 || spec.questions.length > 0 || Boolean(spec.summary));
}

/** The client sets a fact, from the spec sheet or from a question. */
export function setFact(spec: Spec, fact: { id: string; label: string }, value: string | null): Spec {
  const exists = spec.rows.some((r) => r.id === fact.id);
  const row = (r?: SpecRow): SpecRow => ({
    id: fact.id,
    label: r?.label ?? fact.label,
    value,
    source: "you",
    edited: true,
    analysisValue: r?.edited ? r.analysisValue : r?.value ?? undefined,
  });
  return {
    ...spec,
    rows: exists
      ? spec.rows.map((r) => (r.id === fact.id ? row(r) : r))
      : [...spec.rows, row()],
  };
}
