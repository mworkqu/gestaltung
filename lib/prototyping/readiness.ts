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
import { isMakeable, partNeeds, type PartContext, type PartLike } from "./parts";
import { rowOf, type Spec } from "./spec";
import type { BomKind, LineStatus } from "./bom";
import { describeHard, hardFlagId, hardRules, type Netlist } from "./netlist";
import { isStandardFact } from "./analysis";

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
  /**
   * Known boards the project uses (footprints.projectBoards over its BOM,
   * catalog parts and store lines), so an enclosure too small for its board
   * ("tooSmall") blocks like any other part need (audit #5).
   */
  boards?: PartContext["boards"];
  /**
   * Only when the Electronics branch is active: the build route, whether the
   * list exists, and the stored circuit (projects.netlist) our hard rules check.
   */
  electronics?: {
    route: string | null;
    built: boolean;
    netlist?: Netlist | null;
    /** Ids of the BOM lines still on the list (not removed): every circuit part must point at one. */
    lineIds?: string[];
  } | null;
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

/** DOM id of the circuit card under Electronics › Board. */
export const CIRCUIT_FOCUS = "circuit-card";

/** A circuit requirement: resolved on the Board, where the circuit is drawn. */
export const isCircuitRequirement = (r: Pick<Requirement, "id">) =>
  r.id === "circuit_clean" || r.id.startsWith("circuit:");

export function projectReadiness(p: ReadinessInput, t: Translate): Readiness {
  const req: Requirement[] = [];
  const partCtx: PartContext = { boards: p.boards ?? [] };
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

  // Needs your input: one requirement per open question that changes the plan
  // (the standard facts: quantity, power, mounting, environment). Other
  // questions are optional details and never block (owner, 2026-09-29: "if the
  // information won't change anything, skip it"). "Not decided yet" is a
  // recorded answer, so it satisfies the question.
  for (const q of (spec?.questions ?? []).filter((x) => isStandardFact(x.id))) {
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
    const needs = partNeeds(part, partCtx);
    add(
      { id: `part:${part.id}`, group: "parts", label: `${part.code} ${part.name}`, satisfied: !needs.length },
      needs.length
        ? t("block_part", { code: part.code, name: part.name, need: t(`partNeed_${needs[0]}`) })
        : ""
    );
  }

  // Electronics: the client chooses how they are built before any list is
  // made, then builds the list.
  if (p.electronics) {
    add(
      { id: "electronics_route", group: "bom", label: t("req_electronicsRoute"), satisfied: !!p.electronics.route, focus: "board-choice", bomKind: "electronics" },
      t("block_electronicsRoute")
    );
    if (p.electronics.route)
      add(
        { id: "electronics_list", group: "bom", label: t("req_electronicsList"), satisfied: p.electronics.built, focus: "route-card", bomKind: "electronics" },
        t("block_electronicsList")
      );

    // The circuit must pass our hard rules (audit #1): an inductive load
    // without a driver, an LED without a resistor, two supplies on one net or
    // a rail over budget each block on their own, by name. The tree places
    // these on Electronics › Board, where the circuit is drawn.
    if (p.electronics.route) {
      const n = p.electronics.netlist ?? null;
      const hard = n ? hardRules(n) : [];
      // A part drawn in the circuit whose line was removed from the list: the
      // diagrams and the bill of materials would disagree.
      const live = p.electronics.lineIds ? new Set(p.electronics.lineIds) : null;
      const orphans = n && live ? n.components.filter((c) => !live.has(c.bomId)) : [];
      add(
        {
          id: "circuit_clean",
          group: "bom",
          label: t("req_circuitClean"),
          satisfied: !!n && !hard.length && !orphans.length,
          focus: CIRCUIT_FOCUS,
          bomKind: "electronics",
        },
        n ? t("block_circuitClean") : t("block_circuitMissing")
      );
      for (const c of orphans) {
        const text = t("block_circuitOrphan", { ref: `${c.ref} (${c.function})` });
        add({ id: `circuit:orphan:${c.ref}`, group: "bom", label: text, satisfied: false, focus: CIRCUIT_FOCUS, bomKind: "electronics" }, text);
      }
      const seen = new Set<string>();
      for (const f of hard) {
        const id = hardFlagId(f);
        if (seen.has(id)) continue;
        seen.add(id);
        const text = describeHard(f, n!, t);
        add({ id, group: "bom", label: text, satisfied: false, focus: CIRCUIT_FOCUS, bomKind: "electronics" }, text);
      }
    }
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
    const ok = makeable.every((x) => !partNeeds(x, partCtx).length);
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
