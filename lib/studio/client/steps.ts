// Design Studio client flow (Phase 1): the steps, in order, and what "done"
// means for each — derived from the saved StudioDoc, never stored separately.
//
// Phase 2 adds "print" after "enclosure": one entry in FLOW (and its copy in
// messages Studio.step_print / kicker_print / title_print / intro_print).

import type { StepId } from "@/lib/studio/palette";
import type { ProductSpec, StudioDoc } from "@/lib/studio/schema";

export const FLOW = ["idea", "parts", "wiring", "enclosure", "code", "make"] as const satisfies readonly StepId[];
export type FlowStep = (typeof FLOW)[number];

export function isFlowStep(v: unknown): v is FlowStep {
  return typeof v === "string" && (FLOW as readonly string[]).includes(v);
}

/** Steps with no data of their own: done only once the visitor has passed them. */
export const PASS_ONLY: readonly FlowStep[] = ["code", "make"];
const PASSED_PREFIX = "passed:";

/** Has the visitor already moved on from this step (stored in doc.answers, never a future step)? */
export function hasPassed(step: FlowStep, doc: StudioDoc | null): boolean {
  return Boolean(doc?.answers?.[`${PASSED_PREFIX}${step}`]);
}

/** The doc.answers entries for the steps passed so far (kept when the chat answers are rewritten). */
export function passedAnswers(answers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(answers ?? {}).filter(([k]) => k.startsWith(PASSED_PREFIX)));
}

/** doc.answers with `step` marked passed (same object when it already was). */
export function markPassed(answers: Record<string, string> | undefined, step: FlowStep): Record<string, string> {
  if (answers?.[`${PASSED_PREFIX}${step}`]) return answers;
  return { ...(answers ?? {}), [`${PASSED_PREFIX}${step}`]: "1" };
}

/** Whether a step's own result is in the doc. Code and Make have nothing of their own: they count once passed. */
export function stepDone(step: FlowStep, doc: StudioDoc | null): boolean {
  if (!doc) return false;
  switch (step) {
    case "idea":
      return true; // a doc only exists once the idea summary was accepted
    case "parts":
      return doc.components.length > 0;
    case "wiring":
      return doc.checks.length > 0 && doc.netlist.nets.length > 0;
    case "enclosure":
      return doc.enclosure !== null;
    case "code":
      return hasPassed("code", doc);
    case "make":
      return hasPassed("make", doc);
  }
}

/** Index of the first step that is not done (the last step when all are). */
export function firstOpenStep(doc: StudioDoc | null): number {
  const i = FLOW.findIndex((s) => !stepDone(s, doc));
  return i === -1 ? FLOW.length - 1 : i;
}

/**
 * The furthest step a visitor may open: the first open step, or further when
 * they already walked past it in this visit (`visited`). Steps after it are
 * shown but disabled.
 */
export function furthestStep(doc: StudioDoc | null, visited: number): number {
  return Math.min(FLOW.length - 1, Math.max(firstOpenStep(doc), visited));
}

/** The step to open on load: ?step= when it is reachable, else the first open one. */
export function initialStep(doc: StudioDoc | null, requested: string | null | undefined): number {
  const open = firstOpenStep(doc);
  if (isFlowStep(requested)) {
    const i = FLOW.indexOf(requested);
    if (i <= open) return i;
  }
  return open;
}

/** Same product idea? (key order independent for the enum lists). */
export function sameSpec(a: ProductSpec | null | undefined, b: ProductSpec | null | undefined): boolean {
  if (!a || !b) return false;
  const key = (s: ProductSpec) =>
    JSON.stringify({ ...s, inputs: [...s.inputs].sort(), outputs: [...s.outputs].sort() });
  return key(a) === key(b);
}

// ── The idea chat history, kept in doc.answers ──────────────────────────────
// answers = { idea: "<first message>", "q:<question>": "<answer>", … } in the
// order they were given, so later steps never ask again and "Edit" reopens the
// same conversation.

export type IdeaMessage = { role: "user" | "assistant"; text: string; choices?: string[] };

export const IDEA_KEY = "idea";
const Q_PREFIX = "q:";

export function answersFrom(idea: string, messages: IdeaMessage[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (idea.trim()) out[IDEA_KEY] = idea.trim().slice(0, 2000);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const next = messages[i + 1];
    if (m.role === "assistant" && next?.role === "user") out[`${Q_PREFIX}${m.text.slice(0, 300)}`] = next.text.slice(0, 1500);
  }
  return out;
}

export function historyFrom(answers: Record<string, string> | undefined): { idea: string; messages: IdeaMessage[] } {
  const messages: IdeaMessage[] = [];
  let idea = "";
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (k === IDEA_KEY) idea = v;
    else if (k.startsWith(Q_PREFIX)) messages.push({ role: "assistant", text: k.slice(Q_PREFIX.length) }, { role: "user", text: v });
  }
  return { idea, messages };
}

// ── Friendly facts for the idea summary ─────────────────────────────────────
// Message keys under Studio (fact_use_desk, fact_power_battery, …): plain
// sentences, never the enum words themselves.

export function factKeys(spec: ProductSpec): string[] {
  const keys = [`fact_use_${spec.use}`, `fact_power_${spec.power}`];
  if (spec.environment === "outdoor" && spec.use !== "outdoor") keys.push("fact_env_outdoor");
  const outs = spec.outputs.slice(0, 2).map((o) => `fact_out_${o}`);
  const ins = spec.inputs.filter((i) => i !== "none").slice(0, 1).map((i) => `fact_in_${i}`);
  keys.push(...outs, ...ins);
  keys.push(`fact_size_${spec.sizeHint}`);
  return keys.slice(0, 5);
}

// ── Small helpers ───────────────────────────────────────────────────────────

/** A new instance id for a part that is not taken yet: esp32_devkit_1, _2… */
export function nextInstanceId(partId: string, taken: readonly { instanceId: string }[]): string {
  const ids = new Set(taken.map((c) => c.instanceId));
  let n = 1;
  while (ids.has(`${partId}_${n}`)) n++;
  return `${partId}_${n}`;
}

/** "Try another look" versions left, when the server did not say (after a reload). */
export function looksLeftFromVersions(versions: number): number {
  if (versions <= 0) return 0;
  const used = ((versions - 1) % 3) + 1;
  return 3 - used;
}

/** A file-name-safe slug of the project name ("my-desk-lamp"). */
export function fileSlug(name: string | null | undefined): string {
  const s = (name ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return s || "design";
}
