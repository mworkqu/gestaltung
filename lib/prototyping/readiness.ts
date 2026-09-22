// Readiness: the ONE place that decides what this project still needs.
//
// The header percentage, the tree's open-item counts and the footer "open
// items" count all read from here (the tree maps requirements onto its nodes
// in ./tree) — nothing on the page computes its own number. The percentage is
// only ever satisfied ÷ total requirements: a count, not a weighting, so it
// never implies a measurement we are not making.
//
// Pure. Labels come back already translated through the injected `t`, so the
// same result renders in English and Arabic.

import { MIN_BRIEF_CHARS } from "./constants";
import { isMakeable, partNeeds, type PartLike } from "./parts";
import { rowOf, type Spec } from "./spec";
import type { BomKind, LineStatus } from "./bom";

/** Which area of the workspace a requirement belongs to. */
export type RequirementGroup = "brief" | "understanding" | "inputs" | "parts" | "bom" | "route";

export type Requirement = {
  id: string;
  group: RequirementGroup;
  label: string;
  satisfied: boolean;
  /** Present exactly when unsatisfied: what is missing, in words. */
  blockingReason?: string;
  /** DOM id of the control that resolves it, when there is one. */
  focus?: string;
  /** For a bill-of-materials line: which kind, so the tree puts it in the right branch. */
  bomKind?: BomKind;
};

export type Readiness = {
  requirements: Requirement[];
  satisfiedCount: number;
  totalCount: number;
  percent: number;
};

export type ReadinessInput = {
  brief: string | null;
  spec: Spec | null | undefined;
  parts: PartLike[];
  routeAccepted: boolean;
  /** Bill of materials with its live store matches; absent until matched. */
  bom?: { lines: { id: string; function: string; kind: BomKind }[]; matches: Map<string, { status: LineStatus }> } | null;
};

export type Translate = (key: string, params?: Record<string, string | number>) => string;

// Two or more of these in one text means it is database code, not a product
// description — it once reached a brief by a mis-paste of a migration.
const SCHEMA_SIGNS = [
  /\b(create|alter|drop)\s+(table|index|trigger|policy|function)\b/i,
  /\breferences\s+public\.\w+/i,
  /\bon\s+delete\s+cascade\b/i,
  /\b(uuid|timestamptz|jsonb|integer|text)\s+(not\s+null|primary\s+key|default)\b/i,
  /\bgen_random_uuid\(\)/i,
];

export function looksLikeSchema(text: string | null): boolean {
  if (!text) return false;
  return SCHEMA_SIGNS.filter((re) => re.test(text)).length >= 2;
}

export function wordCount(text: string): number {
  const s = text.trim();
  return s ? s.split(/\s+/).length : 0;
}

/** A fact's label: ours for the standard ids, the analysis's for the rest. */
export const factLabel = (id: string, label: string, t: Translate) =>
  ["quantity", "power", "mounting", "environment"].includes(id) ? t(`fact_${id}`) : label;

export const factFocus = (id: string) => `fact-${id}`;

export function projectReadiness(p: ReadinessInput, t: Translate): Readiness {
  const req: Requirement[] = [];
  const add = (r: Omit<Requirement, "blockingReason">, reason: string) =>
    req.push(r.satisfied ? r : { ...r, blockingReason: reason });

  // Brief
  const brief = (p.brief ?? "").trim();
  const schema = looksLikeSchema(brief);
  add(
    {
      id: "brief",
      group: "brief",
      label: t("req_brief"),
      satisfied: !schema && brief.length >= MIN_BRIEF_CHARS,
      focus: "brief-editor",
    },
    schema ? t("block_briefSchema") : t("block_briefMissing")
  );

  // What we understood: analysed, then confirmed as a block.
  const spec = p.spec ?? null;
  add(
    { id: "understanding", group: "understanding", label: t("req_understanding"), satisfied: !!spec?.confirmed },
    spec ? t("block_specUnconfirmed") : t("block_notAnalysed")
  );

  // Needs your input: one requirement per open question. "Not decided yet" is
  // a recorded answer, so it satisfies the question.
  for (const q of spec?.questions ?? []) {
    const label = factLabel(q.id, q.label, t);
    add(
      { id: `q:${q.id}`, group: "inputs", label, satisfied: !!rowOf(spec, q.id)?.edited, focus: factFocus(q.id) },
      t("block_question", { label })
    );
  }
  // A quote needs an actual number, whatever else was left undecided.
  const qty = rowOf(spec, "quantity");
  if (qty && qty.value === null) {
    add(
      { id: "quantity", group: "inputs", label: t("fact_quantity"), satisfied: false, focus: factFocus("quantity") },
      t("block_quantityUndecided")
    );
  }

  // Parts: one requirement per part, so every gap has a name.
  if (p.parts.length === 0) {
    add({ id: "parts", group: "parts", label: t("req_parts"), satisfied: false }, t("block_noParts"));
  }
  for (const part of p.parts) {
    const needs = partNeeds(part);
    add(
      { id: `part:${part.id}`, group: "parts", label: `${part.code} ${part.name}`, satisfied: !needs.length },
      needs.length
        ? t("block_part", { code: part.code, name: part.name, need: t(`partNeed_${needs[0]}`) })
        : ""
    );
  }

  // Bill of materials: a line with several store candidates waits on the
  // client's pick. Matched, owned and not-stocked lines need nothing from them.
  for (const l of p.bom?.lines ?? []) {
    if (p.bom!.matches.get(l.id)?.status !== "choose") continue;
    add(
      { id: `bom:${l.id}`, group: "bom", label: l.function, satisfied: false, focus: `bom-${l.id}`, bomKind: l.kind },
      t("block_bomChoose", { function: l.function })
    );
  }

  // Route: only parts a workshop makes need one. An accepted route counts only
  // while every part it was built from is still valid.
  const makeable = p.parts.filter(isMakeable);
  if (makeable.length) {
    const ok = makeable.every((x) => !partNeeds(x).length);
    add(
      { id: "route", group: "route", label: t("req_route"), satisfied: p.routeAccepted && ok },
      p.routeAccepted ? t("block_routeStale") : t("block_route")
    );
  }

  const satisfiedCount = req.filter((r) => r.satisfied).length;
  return {
    requirements: req,
    satisfiedCount,
    totalCount: req.length,
    percent: req.length ? Math.round((satisfiedCount / req.length) * 100) : 0,
  };
}
