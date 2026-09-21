// "What we understood", as data: a spec sheet of facts plus the questions the
// analysis could not answer. Stored whole in projects.spec (migration 0022).
//
// The rule that shapes everything here: anything the client typed, edited or
// selected wins over anything an analysis returns. A re-analysis may add and
// refresh facts, but an edited row keeps the client's value and only records
// what the analysis said beside it, so the UI can show "kept your answer".

import type { Analysis, Answer, FallbackReason, Question } from "./analysis";

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

export type Spec = {
  summary: string;
  rows: SpecRow[];
  questions: Question[];
  /** The client confirmed the facts the analysis read. */
  confirmed: boolean;
  /** Which reader produced the facts, and why the basic one was used if it was. */
  provider: string;
  fallback: FallbackReason | null;
};

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
  meta: { provider: string; fallback: FallbackReason | null }
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
  };
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
