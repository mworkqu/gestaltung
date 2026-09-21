// Readiness: the ONE place that decides what this project still needs.
//
// The header percentage, the tree's open-item counts and the footer "open
// items" count all read from here (the tree maps requirements onto its nodes
// in ./tree) — nothing on the page computes its own number. The percentage is only ever satisfied ÷ total requirements: a count,
// not a weighting, so it never implies a measurement we are not making.
//
// Pure. Labels come back already translated through the injected `t`, so the
// same result renders in English and Arabic.

import { isCompatible, MIN_BRIEF_CHARS } from "./constants";

/** Which area of the workspace a requirement belongs to. */
export type RequirementGroup = "brief" | "understanding" | "parts" | "route";

export type Requirement = {
  id: string;
  group: RequirementGroup;
  label: string;
  satisfied: boolean;
  /** Present exactly when unsatisfied: what is missing, in words. */
  blockingReason?: string;
};

export type Readiness = {
  requirements: Requirement[];
  satisfiedCount: number;
  totalCount: number;
  percent: number;
};

export type ReadinessInput = {
  brief: string | null;
  claims: { status: string }[];
  parts: {
    id: string;
    code: string;
    name: string;
    status: string;
    material: string | null;
    process: string | null;
  }[];
  routeAccepted: boolean;
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

const settled = (status: string) => status === "confirmed" || status === "corrected";

export function projectReadiness(p: ReadinessInput, t: Translate): Readiness {
  const req: Requirement[] = [];
  const add = (r: Omit<Requirement, "blockingReason">, reason: string) =>
    req.push(r.satisfied ? r : { ...r, blockingReason: reason });

  // Brief
  const brief = (p.brief ?? "").trim();
  const schema = looksLikeSchema(brief);
  add(
    { id: "brief", group: "brief", label: t("req_brief"), satisfied: !schema && brief.length >= MIN_BRIEF_CHARS },
    schema ? t("block_briefSchema") : t("block_briefMissing")
  );

  // Understanding
  const pending = p.claims.filter((c) => !settled(c.status) && c.status !== "dismissed").length;
  add(
    { id: "understanding", group: "understanding", label: t("req_understanding"), satisfied: p.claims.length > 0 && pending === 0 },
    p.claims.length === 0 ? t("block_notAnalysed") : t("block_understanding", { count: pending })
  );

  // Parts: one requirement per part, so every gap has a name.
  if (p.parts.length === 0) {
    add({ id: "parts", group: "parts", label: t("req_parts"), satisfied: false }, t("block_noParts"));
  }
  for (const part of p.parts) {
    const who = { code: part.code, name: part.name };
    const reason = !part.material
      ? t("block_partMaterial", who)
      : !part.process
        ? t("block_partProcess", who)
        : !isCompatible(part.material, part.process)
          ? t("block_partMismatch", who)
          : part.status === "suggested"
            ? t("block_partUnconfirmed", who)
            : null;
    add(
      { id: `part:${part.id}`, group: "parts", label: t("req_part", who), satisfied: reason === null },
      reason ?? ""
    );
  }

  // Route: an accepted route only counts while every part it was built from
  // is still valid — editing a part after accepting reopens it.
  const partsOk = p.parts.length > 0 && req.every((r) => r.group !== "parts" || r.satisfied);
  add(
    { id: "route", group: "route", label: t("req_route"), satisfied: p.routeAccepted && partsOk },
    p.routeAccepted ? t("block_routeStale") : t("block_route")
  );

  const satisfiedCount = req.filter((r) => r.satisfied).length;
  return {
    requirements: req,
    satisfiedCount,
    totalCount: req.length,
    percent: req.length ? Math.round((satisfiedCount / req.length) * 100) : 0,
  };
}
