// The AI product designer (P5-16 Phase 2a). Pure orchestration around an
// injected StudioCall (validatedCall: Gemini JSON mode + responseSchema, metered
// in ai_usage feature "studio", step "product", one retry with the problems).
//
//   archetypes (ours, ranked) ─► designer prompt with each archetype's DEFAULT
//   ─► AI JSON ─► structural check (retry once) ─► clampProductModel
//   ─► ensurePhysical (solver homes: every part appears) ─► why EN/AR
//
// Any failure → the archetype defaults (never a blank screen). Variants are
// different archetypes (productVariants' ranking), never colour-only.

import type { LayoutInput } from "../../layout";
import type { ClampLog, ProductSpec } from "../../schema";
import { stableHash } from "../../cache";
import { isObj, type StudioCall } from "../../ai/types";
import { archetypeDefault, rankArchetypes } from "../archetypes";
import { POWER_PORTS, isButtonPart, isLight, isPump, isSoilProbe } from "../parts";
import { ARCHETYPES, ATTACH_ROOTS, FORM_KINDS, PRODUCT_LIMITS, clampProductModel, type Archetype, type ProductModel } from "../schema";
import { ensurePhysical } from "./physical";
import { DESIGNER_SYSTEM, designerPrompt, designerSchema, type DesignerPart } from "./prompt";
import { whyFor, type Why } from "./why";

export type DesignOut = {
  archetype: Archetype;
  model: ProductModel;
  why: Why;
  source: "ai" | "default";
  /** Solver issues + clamp notes (Engineer view). */
  issues: unknown[];
  solvedHash: string;
};

export type DesignRun = {
  designs: DesignOut[];
  /** "model" when the AI answered, else why we used the defaults. */
  source: "model" | "default";
  problems: string[];
  clampLog: ClampLog;
  modelName?: string | null;
};

/** The archetypes to design: best for the spec first, skipping `exclude`. */
export function pickArchetypes(spec: ProductSpec, count: number, exclude: readonly string[] = []): Archetype[] {
  const n = Math.max(1, Math.min(3, Math.round(count)));
  const skip = new Set(exclude);
  return rankArchetypes(spec)
    .map((r) => r.archetype)
    .filter((a) => !skip.has(a))
    .slice(0, n);
}

/** What the designer is told about each part (name, category, size, what it needs physically). */
export function designerParts(parts: readonly LayoutInput[]): DesignerPart[] {
  return parts
    .filter((p) => !p.part.helper || p.part.ports.length > 0)
    .map((p) => {
      const notes: string[] = [];
      if (isPump(p.part)) notes.push("pump: needs a reservoir, a tube and a water outlet");
      if (isSoilProbe(p.part)) notes.push("soil probe: prongs must be in the soil on a stake");
      if (isLight(p.part)) notes.push("light: must shine through a clear ring or window");
      if (isButtonPart(p.part)) notes.push("button: needs a cap the user can press");
      if (p.part.ports.some((q) => POWER_PORTS.includes(q.kind))) notes.push("USB / power socket: must be reachable");
      if (p.part.ports.some((q) => q.kind === "speaker_grille")) notes.push("speaker: needs a grille");
      return { name: p.part.name.en, category: p.part.category, size: [p.part.dims.x, p.part.dims.y, p.part.dims.z] as [number, number, number], notes };
    });
}

const ROOTS = ATTACH_ROOTS as readonly string[];

/** Structural problems of one AI model (what clamping would silently paper over). */
export function modelProblems(raw: unknown, label: string): string[] {
  if (!isObj(raw)) return [`${label}: model must be an object`];
  const errs: string[] = [];
  const bodies = Array.isArray(raw.bodies) ? raw.bodies : null;
  if (!bodies) return [`${label}: bodies must be a list`];
  if (bodies.length < PRODUCT_LIMITS.bodies.min || bodies.length > PRODUCT_LIMITS.bodies.max)
    errs.push(`${label}: use ${PRODUCT_LIMITS.bodies.min}–${PRODUCT_LIMITS.bodies.max} bodies (got ${bodies.length})`);
  const ids = new Set<string>();
  bodies.forEach((b, i) => {
    if (!isObj(b)) return void errs.push(`${label}: body ${i} must be an object`);
    if (typeof b.id === "string") ids.add(b.id);
  });
  bodies.forEach((b, i) => {
    if (!isObj(b)) return;
    const form = isObj(b.form) ? b.form : null;
    if (!form || typeof form.kind !== "string" || !(FORM_KINDS as readonly string[]).includes(form.kind))
      errs.push(`${label}: body ${String(b.id ?? i)} form.kind must be one of: ${FORM_KINDS.join(", ")}`);
    const to = isObj(b.attach) ? b.attach.to : undefined;
    if (typeof to !== "string" || !(ROOTS.includes(to) || (ids.has(to) && to !== b.id)))
      errs.push(`${label}: body ${String(b.id ?? i)} attach.to must be another body id, "ground" or "scene"`);
  });
  if (typeof raw.electronicsHost !== "string" || !ids.has(raw.electronicsHost))
    errs.push(`${label}: electronicsHost must be the id of one of its bodies`);
  return errs;
}

type RawDesign = { archetype: Archetype; model: ProductModel; why: { en?: unknown; ar?: unknown }; log: ClampLog };

/**
 * The default's bodies the AI dropped. The defaults are tuned to be recognised at a
 * glance (the bowl of a feeder, the stem of a lamp, the plate of a doorbell), so the
 * designer refines them and may add to them, but keeps them (P5-16d: real runs showed
 * designs that dropped the bowl or the wall plate scoring 3–5).
 */
export function droppedDefaultBodies(raw: Record<string, unknown>, def: ProductModel): ProductModel["bodies"] {
  const ids = new Set((Array.isArray(raw.bodies) ? raw.bodies : []).map((b) => (isObj(b) ? b.id : null)).filter((x): x is string => typeof x === "string"));
  return def.bodies.filter((b) => !ids.has(b.id));
}

/** Put the dropped default bodies back (when their parent is still there and there is room). */
export function restoreDefaultBodies(model: ProductModel, def: ProductModel): ProductModel {
  const missing = def.bodies.filter((b) => !model.bodies.some((x) => x.id === b.id));
  if (!missing.length) return model;
  const out = structuredClone(model);
  for (const b of missing) {
    if (out.bodies.length >= PRODUCT_LIMITS.bodies.max) break;
    const parentOk = (ROOTS as readonly string[]).includes(b.attach.to) || out.bodies.some((x) => x.id === b.attach.to);
    if (parentOk) out.bodies.push(structuredClone(b));
  }
  return clampProductModel(out);
}

/**
 * Validate the designer's answer. Strict (first answer): every asked archetype
 * once, every model structurally sound. Lenient (the retry): keep the sound
 * designs; the caller fills the rest with defaults.
 */
export function validateDesigns(
  raw: unknown,
  archetypes: readonly Archetype[],
  strict: boolean,
  defaults?: ReadonlyMap<Archetype, ProductModel>,
): { value: RawDesign[] | null; errors: string[] } {
  if (!isObj(raw) || !Array.isArray(raw.designs)) return { value: null, errors: ['the answer must be {"designs": [...]}'] };
  const errors: string[] = [];
  const out: RawDesign[] = [];
  for (const a of archetypes) {
    const d = raw.designs.find((x) => isObj(x) && x.archetype === a) ?? raw.designs[archetypes.indexOf(a)];
    if (!isObj(d)) {
      errors.push(`missing the design for archetype ${a}`);
      continue;
    }
    const problems = modelProblems(d.model, a);
    const def = defaults?.get(a);
    const dropped = def && isObj(d.model) ? droppedDefaultBodies(d.model, def) : [];
    // A dropped default body is put back deterministically (no extra model call on the free tier).
    if (problems.length) {
      errors.push(...problems);
      continue;
    }
    const log: ClampLog = [];
    let model = clampProductModel({ ...(d.model as object), archetype: a }, log);
    if (def && dropped.length) model = restoreDefaultBodies(model, def);
    out.push({ archetype: a, model, why: { en: d.why_en, ar: d.why_ar }, log });
  }
  if (strict ? errors.length > 0 : out.length === 0) return { value: null, errors: errors.slice(0, 12) };
  return { value: out, errors: [] };
}

/** In-memory cache of AI answers (W8 style); only model answers are kept. */
export type DesignCache = { get(key: string): unknown; set(key: string, v: unknown): void };

export function designKey(spec: ProductSpec, parts: readonly LayoutInput[], archetypes: readonly Archetype[]): string {
  return stableHash({ v: 1, spec, parts: parts.map((p) => p.part.id).sort(), archetypes: [...archetypes] });
}

function finish(a: Archetype, model: ProductModel, why: Why, source: "ai" | "default", parts: readonly LayoutInput[], spec: ProductSpec, notes: unknown[]): DesignOut {
  const p = ensurePhysical({ ...model, rationale: why.en }, parts, spec);
  return { archetype: a, model: p.model, why, source, issues: [...notes, ...p.issues], solvedHash: p.solvedHash };
}

export function defaultDesign(a: Archetype, spec: ProductSpec, parts: readonly LayoutInput[]): DesignOut {
  return finish(a, archetypeDefault(a, spec, parts), whyFor(a, null), "default", parts, spec, []);
}

export async function runProductDesign(opts: {
  call: StudioCall | null;
  spec: ProductSpec;
  parts: readonly LayoutInput[];
  archetypes: readonly Archetype[];
  brief?: string | null;
  cache?: DesignCache | null;
}): Promise<DesignRun> {
  const { spec, parts } = opts;
  const archetypes = opts.archetypes.filter((a) => (ARCHETYPES as readonly string[]).includes(a));
  const defaults = (problems: string[]): DesignRun => ({
    designs: archetypes.map((a) => defaultDesign(a, spec, parts)),
    source: "default",
    problems,
    clampLog: [],
  });
  if (!archetypes.length) return defaults([]);
  if (!opts.call) return defaults(["no_model"]);

  const key = designKey(spec, parts, archetypes);
  let raw = opts.cache?.get(key) as RawDesign[] | undefined;
  let modelName: string | null | undefined;
  if (raw) raw = structuredClone(raw);
  else {
    let attempt = 0;
    const defaultModels = new Map(archetypes.map((a) => [a, archetypeDefault(a, spec, parts)] as const));
    const r = await opts.call<RawDesign[]>({
      step: "product",
      system: DESIGNER_SYSTEM,
      prompt: designerPrompt({
        spec,
        brief: opts.brief,
        parts: designerParts(parts),
        starts: archetypes.map((a) => ({ archetype: a, model: defaultModels.get(a)! })),
      }),
      schema: designerSchema(archetypes),
      validate: (v) => validateDesigns(v, archetypes, attempt++ === 0, defaultModels),
      timeoutMs: 90_000,
    });
    if (!r.ok) return defaults([r.error, ...r.problems]);
    raw = r.value;
    modelName = r.model;
    opts.cache?.set(key, structuredClone(raw));
  }

  const clampLog: ClampLog = raw.flatMap((d) => d.log);
  const designs = archetypes.map((a) => {
    const d = raw!.find((x) => x.archetype === a);
    if (!d) return defaultDesign(a, spec, parts);
    return finish(a, d.model, whyFor(a, d.why), "ai", parts, spec, d.log.length ? [{ code: "clamped", severity: "info", detail: `${d.log.length} value(s)` }] : []);
  });
  return { designs, source: "model", problems: [], clampLog, modelName };
}
