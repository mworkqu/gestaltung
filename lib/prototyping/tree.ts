// The workspace tree (reviewer order, 2026-09-28): Brief, then one Concepts
// step for every discipline right under it, then one branch per discipline
// the project needs, then Quote and Production, and the Parts list and the
// Bill of materials at the very end.
//
// Pure. Branches come from what the analysis detected plus the client's own
// choices; a manual choice always wins and an analysis never overwrites it.
// Open-item counts are the readiness requirements (./readiness) mapped onto
// tree nodes — the tree never counts anything itself.
//
// The Parts list shows every part. A branch shows only the to-design parts of
// its kind — the same rows, viewed for design work, never a second copy. The
// Concepts step shows what the analysis suggests designing, for every
// discipline at once, waiting to be kept or dropped — one Continue, not one
// per discipline. A kept concept moves to its branch's design leaf
// (Parts / Board / Scope).

import { DISCIPLINES, type Discipline } from "./constants";
import { detectDisciplines } from "./engine";
import { disciplineOf, isConcept, type PartLike } from "./parts";
import { bomNode } from "./bom";
import { factFocus, isCircuitRequirement, type Readiness, type Requirement, type Translate } from "./readiness";
import { rowOf, type Spec } from "./spec";

export const LEAVES = {
  mechanical: ["mechanical.parts", "mechanical.drawings", "mechanical.process"],
  electronics: ["electronics.board", "electronics.power", "electronics.components"],
  software: ["software.scope"],
} as const satisfies Record<Discipline, readonly string[]>;

export type LeafId = (typeof LEAVES)[Discipline][number];
export type NodeId = "brief" | "concepts" | "parts" | "bom" | "quote" | "production" | LeafId;

/** projects.disciplines (migration 0021). */
export type DisciplineState = {
  /** What the last analysis found. Rewritten by every analysis. */
  detected?: Discipline[];
  /** The client's own add/remove. Never touched by an analysis. */
  manual?: Partial<Record<Discipline, boolean>>;
};

/** Where a to-design part of each kind is worked on. */
export const DESIGN_NODE: Record<Discipline, NodeId> = {
  mechanical: "mechanical.parts",
  electronics: "electronics.board",
  software: "software.scope",
};

/** Where a suggested, not-yet-kept part of each kind waits: the one Concepts step. */
export const CONCEPT_NODE: Record<Discipline, NodeId> = {
  mechanical: "concepts",
  electronics: "concepts",
  software: "concepts",
};

/** The node a part is resolved at: its concepts or design leaf, or the Parts list. */
export const partNode = (p: PartLike): NodeId => {
  const d = disciplineOf(p);
  if (!d) return "parts";
  return isConcept(p) ? CONCEPT_NODE[d] : DESIGN_NODE[d];
};

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
    // A branch with parts to design always needs a home, even if the analysis
    // missed it — otherwise those parts would vanish from the tree.
    const active = manual ?? (detected.includes(d) || partCount > 0);
    return { discipline: d, detected: detected.includes(d), manual, partCount, active };
  });
}

/**
 * The client adds (true) or removes (false) a branch, or "restore" drops their
 * choice so the branch goes back to what the analysis and the parts say — the
 * honest undo of a removal, rather than a forced "on".
 */
export function withBranchChoice(
  state: DisciplineState | null | undefined,
  d: Discipline,
  choice: boolean | "restore"
): DisciplineState {
  const manual = { ...(state?.manual ?? {}) };
  if (choice === "restore") delete manual[d];
  else manual[d] = choice;
  return { ...(state ?? {}), manual };
}

/** Every node the client can see, in reading order. */
export function visibleNodes(bs: Branch[]): NodeId[] {
  const active = bs.filter((b) => b.active);
  return [
    "brief",
    ...(active.length ? (["concepts"] as NodeId[]) : []),
    ...active.flatMap((b) => [...LEAVES[b.discipline]]),
    "quote",
    "production",
    "parts",
    "bom",
  ];
}

/** Where a requirement is resolved. */
export function nodeOf(r: Requirement, parts: PartLike[], visible: NodeId[]): NodeId {
  if (r.group === "brief" || r.group === "understanding" || r.group === "inputs") return "brief";
  if (r.group === "route") return "quote";
  if (isCircuitRequirement(r) && visible.includes("electronics.board")) return "electronics.board";
  if (r.group === "bom") {
    const n = r.bomKind ? (bomNode(r.bomKind) as NodeId) : "bom";
    return visible.includes(n) ? n : "bom";
  }
  const part = r.id.startsWith("part:") ? parts.find((p) => `part:${p.id}` === r.id) : null;
  const n = part ? partNode(part) : "parts";
  return visible.includes(n) ? n : "parts";
}

export type NodeState = {
  /** Unsatisfied requirements resolved at this node. */
  open: Requirement[];
  /** Why this node cannot proceed, when the cause lives elsewhere. */
  reason?: string;
  /** Where clicking the node goes to resolve `reason`. */
  target?: NodeId;
  /** The control to focus there. */
  focus?: string;
};

export function nodeStates(
  r: Readiness,
  parts: PartLike[],
  spec: Spec | null | undefined,
  visible: NodeId[],
  t: Translate,
  /** The electronics build route: a board to design is only needed for a custom PCB. */
  buildRoute: string | null = null
): Record<NodeId, NodeState> {
  const out = {} as Record<NodeId, NodeState>;
  for (const n of visible) out[n] = { open: [] };
  for (const req of r.requirements) {
    if (req.satisfied) continue;
    const n = nodeOf(req, parts, visible);
    (out[n] ??= { open: [] }).open.push(req);
  }

  const set = (n: NodeId, extra: Omit<NodeState, "open">) => {
    if (out[n] && extra.reason) out[n] = { ...out[n], ...extra };
  };
  const ofKind = (d: Discipline) => parts.filter((p) => disciplineOf(p) === d);
  // Kept parts are the design work; concepts still wait on a decision.
  const kept = (d: Discipline) => ofKind(d).filter((p) => !isConcept(p));
  /** Nothing kept yet: point at the waiting concepts, or at the empty design leaf. */
  const nothingKept = (d: Discipline, missing: string): Omit<NodeState, "open"> =>
    ofKind(d).length
      ? { reason: t("need_concept"), target: CONCEPT_NODE[d] }
      : { reason: missing, target: DESIGN_NODE[d] };

  const mech = kept("mechanical");
  const mechNeeds = (checkProcess: boolean): Omit<NodeState, "open"> =>
    !mech.length
      ? nothingKept("mechanical", t("need_parts"))
      : mech.some((p) => !p.material)
        ? { reason: t("need_material"), target: "mechanical.parts" }
        : checkProcess && mech.some((p) => !p.process)
          ? { reason: t("need_process"), target: "mechanical.parts" }
          : {};
  set("mechanical.drawings", mechNeeds(false));
  set("mechanical.process", mechNeeds(true));

  if (buildRoute === "custom_pcb" && !kept("electronics").length)
    set("electronics.board", nothingKept("electronics", t("need_board")));
  if (!kept("software").length) set("software.scope", nothingKept("software", t("need_scope")));

  const power = rowOf(spec, "power");
  if (!power?.value)
    set("electronics.power", { reason: t("need_power"), target: "brief", focus: factFocus("power") });

  // Quote waits on parts first, then on an actual quantity.
  const openPart = r.requirements.find((x) => !x.satisfied && x.group === "parts");
  const qty = rowOf(spec, "quantity");
  if (openPart) set("quote", { reason: t("need_partsConfirmed"), target: nodeOf(openPart, parts, visible) });
  else if (!qty?.value)
    set("quote", { reason: t("need_quantity"), target: "brief", focus: factFocus("quantity") });

  // Production waits on whatever holds up the quote, then on the route.
  const route = r.requirements.find((x) => x.id === "route");
  if (out.quote?.reason) {
    const { reason, target, focus } = out.quote;
    set("production", { reason, target, focus });
  } else if (route && !route.satisfied) set("production", { reason: t("need_route"), target: "quote" });

  return out;
}

/** Map a stored node — or an old stage id from before the tree — onto a visible node. */
export function toNode(stored: string, visible: NodeId[]): NodeId {
  const legacy: Record<string, NodeId> = {
    idea: "brief",
    concepts: "concepts",
    // Per-discipline concept steps before 2026-09-28.
    "mechanical.concepts": "concepts",
    "electronics.concepts": "concepts",
    "software.concepts": "concepts",
    design: "mechanical.drawings",
    engineering: "mechanical.process",
    manufacturing: "mechanical.process",
  };
  const n = (legacy[stored] ?? stored) as NodeId;
  return visible.includes(n) ? n : "brief";
}

/** What initialNode reads from a project. */
export type Opening = {
  /** projects.stage: the node last opened (written on every navigation). */
  stage: string | null | undefined;
  /** projects.spec: null until the brief is first analysed. */
  spec?: unknown;
  disciplines?: DisciplineState | null;
  parts?: readonly unknown[];
};

/**
 * Where the workspace opens (audit #32): on Brief while there is nothing past
 * the brief yet, otherwise where the client left off. A project counts as
 * started once it has been analysed, or has parts or detected disciplines
 * (projects analysed before the spec was stored have parts but no spec). A
 * stored node that no longer exists — a removed branch, an unknown id — falls
 * back to Brief, never to Quote.
 */
export function initialNode(p: Opening, visible: NodeId[]): NodeId {
  const started = p.spec != null || Boolean(p.disciplines?.detected?.length) || Boolean(p.parts?.length);
  if (!started) return "brief";
  return toNode(p.stage ?? "", visible);
}
