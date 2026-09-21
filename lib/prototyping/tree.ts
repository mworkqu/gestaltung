// The workspace tree: Brief, one branch per discipline the project needs, and
// Quote.
//
// Pure. Branches come from what the analysis detected plus the client's own
// choices; a manual choice always wins and an analysis never overwrites it.
// Open-item counts are the readiness requirements (./readiness) mapped onto
// tree nodes — the tree never counts anything itself.

import { DISCIPLINES, type Discipline } from "./constants";
import { detectDisciplines } from "./engine";
import type { Readiness, Requirement, Translate } from "./readiness";

export const LEAVES = {
  mechanical: ["mechanical.parts", "mechanical.drawings", "mechanical.process"],
  electronics: ["electronics.board", "electronics.power", "electronics.components"],
  software: ["software.scope"],
} as const satisfies Record<Discipline, readonly string[]>;

export type LeafId = (typeof LEAVES)[Discipline][number];
export type NodeId = "brief" | "quote" | LeafId;

/** projects.disciplines (migration 0021). */
export type DisciplineState = {
  /** What the last analysis found. Rewritten by every analysis. */
  detected?: Discipline[];
  /** The client's own add/remove. Never touched by an analysis. */
  manual?: Partial<Record<Discipline, boolean>>;
};

type PartLike = { id: string; material: string | null; process: string | null };

/** A board is electronics; everything else we make is mechanical. */
export const disciplineOf = (p: { process: string | null }): Discipline =>
  p.process === "pcb_manufacturing" ? "electronics" : "mechanical";

/** The leaf a part is listed under. */
export const partNode = (p: { process: string | null }): NodeId =>
  disciplineOf(p) === "electronics" ? "electronics.board" : "mechanical.parts";

/** "mechanical.parts" → "node_mechanical_parts" (next-intl keys cannot hold dots). */
export const nodeKey = (n: NodeId) => `node_${n.replace(".", "_")}`;

export type Branch = {
  discipline: Discipline;
  detected: boolean;
  manual: boolean | undefined;
  partCount: number;
  active: boolean;
};

export function branches(
  state: DisciplineState | null | undefined,
  brief: string | null,
  parts: PartLike[]
): Branch[] {
  // Projects analysed before detection was stored fall back to reading the
  // brief now, with the same rules, so they get the same answer.
  const detected = state?.detected ?? (brief ? detectDisciplines(brief) : []);
  return DISCIPLINES.map((d) => {
    const manual = state?.manual?.[d];
    const partCount = parts.filter((p) => disciplineOf(p) === d).length;
    // A branch with parts in it always needs a home, even if the analysis
    // missed it — otherwise those parts would vanish from the tree.
    const active = manual ?? (detected.includes(d) || partCount > 0);
    return { discipline: d, detected: detected.includes(d), manual, partCount, active };
  });
}

/** Every node the client can see, in reading order. */
export function visibleNodes(bs: Branch[]): NodeId[] {
  return ["brief", ...bs.filter((b) => b.active).flatMap((b) => [...LEAVES[b.discipline]]), "quote"];
}

/** Where a requirement is resolved. */
export function nodeOf(r: Requirement, parts: PartLike[], visible: NodeId[]): NodeId {
  if (r.group === "brief" || r.group === "understanding") return "brief";
  if (r.group === "route") return "quote";
  const part = r.id.startsWith("part:") ? parts.find((p) => `part:${p.id}` === r.id) : null;
  if (part) return partNode(part);
  // "No parts yet": the first parts list on screen.
  return visible.find((n) => n === "mechanical.parts" || n === "electronics.board") ?? "brief";
}

export type NodeState = {
  /** Unsatisfied requirements resolved at this node. */
  open: Requirement[];
  /** Why this node cannot proceed, when the cause lives elsewhere. */
  reason?: string;
  /** Where clicking the node goes to resolve `reason`. */
  target?: NodeId;
};

export function nodeStates(
  r: Readiness,
  parts: PartLike[],
  visible: NodeId[],
  power: string | null,
  t: Translate
): Record<NodeId, NodeState> {
  const out = {} as Record<NodeId, NodeState>;
  for (const n of visible) out[n] = { open: [] };
  for (const req of r.requirements) {
    if (req.satisfied) continue;
    const n = nodeOf(req, parts, visible);
    (out[n] ??= { open: [] }).open.push(req);
  }

  const mech = parts.filter((p) => disciplineOf(p) === "mechanical");
  const needs = (checkProcess: boolean): Omit<NodeState, "open"> =>
    !mech.length
      ? { reason: t("need_parts"), target: "mechanical.parts" }
      : mech.some((p) => !p.material)
        ? { reason: t("need_material"), target: "mechanical.parts" }
        : checkProcess && mech.some((p) => !p.process)
          ? { reason: t("need_process"), target: "mechanical.parts" }
          : {};

  const set = (n: NodeId, extra: Omit<NodeState, "open">) => {
    if (out[n]) out[n] = { ...out[n], ...extra };
  };
  set("mechanical.drawings", needs(false));
  set("mechanical.process", needs(true));
  if (!parts.some((p) => disciplineOf(p) === "electronics"))
    set("electronics.board", { reason: t("need_board"), target: "electronics.board" });
  if (!power) set("electronics.power", { reason: t("need_power"), target: "brief" });

  const openPart = r.requirements.find((x) => !x.satisfied && x.group === "parts");
  if (openPart)
    set("quote", { reason: t("need_partsConfirmed"), target: nodeOf(openPart, parts, visible) });

  return out;
}

/** Map an old stage id (before the tree) onto a node. */
export function toNode(stored: string, visible: NodeId[]): NodeId {
  const legacy: Record<string, NodeId> = {
    idea: "brief",
    concepts: "brief",
    parts: "mechanical.parts",
    design: "mechanical.drawings",
    engineering: "mechanical.drawings",
    manufacturing: "quote",
    production: "quote",
  };
  const n = (legacy[stored] ?? stored) as NodeId;
  return visible.includes(n) ? n : "brief";
}
