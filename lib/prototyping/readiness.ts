// Readiness: the ONE place that decides what this project still needs.
//
// The header percentage, the sidebar counters, the footer "open items" count
// and every stage status read from here — nothing on the page computes its own
// number. The percentage is only ever satisfied ÷ total requirements: a count,
// not a weighting, so it never implies a measurement we are not making.
//
// Pure. Labels come back already translated through the injected `t`, so the
// same result renders in English and Arabic.

import { isCompatible, MIN_BRIEF_CHARS, type Stage, type StageStatus } from "./constants";

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
  /** Part ids that have at least one ready schematic. Drives Design only. */
  schematicPartIds: string[];
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

/** Requirements that must be met before leaving each stage. */
export const STAGE_GROUPS: Record<Stage, RequirementGroup[]> = {
  idea: ["brief", "understanding"],
  concepts: [],
  parts: ["parts"],
  design: [],
  engineering: [],
  manufacturing: ["route"],
  quote: [],
  production: [],
};

/** Where to go to fix a requirement in this group. */
export const GROUP_STAGE: Record<RequirementGroup, Stage> = {
  brief: "idea",
  understanding: "idea",
  parts: "parts",
  route: "manufacturing",
};

export type StageState = { status: StageStatus; waitingOn?: Stage };

/**
 * Every stage's status as a function of its own contents, capped by its
 * prerequisite: a stage whose prerequisite is not complete is locked, however
 * much is in it, so the rail can never claim progress out of order.
 */
export function stageStatuses(p: ReadinessInput, r: Readiness): Record<Stage, StageState> {
  const group = (g: RequirementGroup) => r.requirements.filter((x) => x.group === g);
  const done = (g: RequirementGroup) => group(g).length > 0 && group(g).every((x) => x.satisfied);

  const own = (status: StageStatus, prereq: Stage | null, out: Partial<Record<Stage, StageState>>): StageState =>
    prereq && out[prereq]?.status !== "complete" ? { status: "locked", waitingOn: prereq } : { status };

  const out: Partial<Record<Stage, StageState>> = {};
  out.idea = {
    status:
      done("brief") && done("understanding")
        ? "complete"
        : (p.brief ?? "").trim() || p.claims.length
          ? "progress"
          : "needs",
  };
  out.concepts = own("optional", "idea", out);
  out.parts = own(done("parts") ? "complete" : p.parts.length ? "progress" : "needs", "idea", out);

  const drawn = p.parts.filter((x) => p.schematicPartIds.includes(x.id)).length;
  out.design = own(
    p.parts.length && drawn === p.parts.length ? "complete" : drawn ? "progress" : "needs",
    "parts",
    out
  );
  out.engineering = own("optional", "parts", out);
  out.manufacturing = own(done("route") ? "complete" : "needs", "parts", out);
  out.quote = own("needs", "manufacturing", out);
  // Production opens when a quote is accepted, which happens outside this
  // workspace, so it has nothing of its own to show yet.
  out.production = { status: "locked", waitingOn: "quote" };

  return out as Record<Stage, StageState>;
}
