// clamp*() helpers: turn ANY value (usually AI JSON) into a valid one. Bad
// enums fall back to safe defaults, numbers are clamped to their ranges, and
// every change is recorded in a ClampLog for admin (never shown to clients).
// Import from "./schema".

import {
  ACTUATOR_LOADS, BUILD_CLASSES, COLOURS, ENCLOSURE_TEMPLATES, ENVIRONMENTS, FEET, FINISHES,
  HEIGHT_BIASES, INPUTS, LIDS, LIMITS, MATERIALS, MECH_TEMPLATES, MOVER_KINDS, OUTPUTS,
  PLACEMENTS, POWERS, SIDE_VENT_FACES, SIZE_HINTS, STYLES, USES, VENT_FACES, VENT_PATTERNS,
  type ActuatorKind, type BuildClass, type EnclosureTemplate, type MechTemplate,
  type MoverKind, type Placement,
} from "./schema-enums";
import type {
  Actuator, EnclosureSpec, MechPart, ProductSpec, Understanding, UnderstandingMover,
  UnderstandingPart,
} from "./schema-zod";
import { DEFAULT_ENCLOSURE, DEFAULT_SPEC, MECH_PARAMS } from "./schema-defaults";

const U = LIMITS.understanding;

export type ClampLog = { path: string; from: unknown; to: unknown }[];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function pickEnum<T extends string>(
  values: readonly T[], v: unknown, fallback: T, path: string, log: ClampLog,
): T {
  if (typeof v === "string") {
    const lower = v.trim().toLowerCase();
    const norm = lower.replace(/[\s-]+/g, "_");
    // Exact (lower-cased) first: faces such as "-y" must not become "_y".
    const hit = values.find((x) => x === lower) ?? values.find((x) => x === norm);
    if (hit) {
      if (hit !== v) log.push({ path, from: v, to: hit });
      return hit;
    }
  }
  log.push({ path, from: v, to: fallback });
  return fallback;
}

export function clampNum(
  v: unknown, min: number, max: number, fallback: number, path: string, log: ClampLog,
  opts: { int?: boolean } = {},
): number {
  let n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) {
    log.push({ path, from: v, to: fallback });
    return fallback;
  }
  const original = n;
  if (opts.int) n = Math.round(n);
  n = Math.min(max, Math.max(min, n));
  if (n !== original || typeof v !== "number") log.push({ path, from: v, to: n });
  return n;
}

function clampStr(v: unknown, max: number, fallback: string, path: string, log: ClampLog): string {
  if (typeof v !== "string") {
    log.push({ path, from: v, to: fallback });
    return fallback;
  }
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length === 0) {
    log.push({ path, from: v, to: fallback });
    return fallback;
  }
  if (s.length > max) {
    const cut = s.slice(0, max).trim();
    log.push({ path, from: v, to: cut });
    return cut;
  }
  return s;
}

function enumList<T extends string>(
  values: readonly T[], v: unknown, path: string, log: ClampLog,
): T[] {
  if (!Array.isArray(v)) {
    if (v !== undefined) log.push({ path, from: v, to: [] });
    return [];
  }
  const out: T[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const norm = item.trim().toLowerCase().replace(/[\s-]+/g, "_") as T;
    if (values.includes(norm) && !out.includes(norm)) out.push(norm);
  }
  if (out.length !== v.length) log.push({ path, from: v, to: out });
  return out;
}

/**
 * Part B: any value → valid actuator groups (absent when there are none). Bad kinds are
 * dropped, counts rounded and clamped to 1..8, a bad load becomes "medium", groups beyond
 * 4 are cut. Every change is logged; never throws.
 */
export function clampActuators(v: unknown, log: ClampLog = []): Actuator[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    log.push({ path: "actuators", from: v, to: [] });
    return [];
  }
  const out: Actuator[] = [];
  v.forEach((item, i) => {
    const path = `actuators[${i}]`;
    if (!isObj(item)) {
      log.push({ path, from: item, to: null });
      return;
    }
    // "Servos", "stepper motor", "DC motor" → the kind they name (stepper before motor).
    const rawKind = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "";
    const kind = (["stepper", "servo", "pump", "motor"] as const).find((k) => rawKind.includes(k)) as ActuatorKind | undefined;
    if (!kind) {
      log.push({ path: `${path}.kind`, from: item.kind, to: null });
      return;
    }
    if (kind !== item.kind) log.push({ path: `${path}.kind`, from: item.kind, to: kind });
    if (out.length >= LIMITS.actuators.max) {
      log.push({ path, from: item, to: null });
      return;
    }
    const count = clampNum(item.count, LIMITS.actuators.countMin, LIMITS.actuators.countMax, 1, `${path}.count`, log, { int: true });
    const load = pickEnum(ACTUATOR_LOADS, item.load, "medium", `${path}.load`, log);
    const role = typeof item.role === "string" && item.role.trim() ? clampStr(item.role, LIMITS.actuators.roleMax, "", `${path}.role`, log) : "";
    if (item.role !== undefined && item.role !== null && typeof item.role !== "string") log.push({ path: `${path}.role`, from: item.role, to: null });
    out.push({ kind, count, load, ...(role ? { role } : {}) });
  });
  return out;
}

/** Any value → a valid ProductSpec. quantity is always 1 on this site. */
export function clampSpec(input: unknown, log: ClampLog = []): ProductSpec {
  const o = isObj(input) ? input : {};
  if (!isObj(input)) log.push({ path: "spec", from: input, to: "default" });
  let name = clampStr(o.name, LIMITS.name.max, DEFAULT_SPEC.name, "name", log);
  if (name.length < LIMITS.name.min) {
    log.push({ path: "name", from: name, to: DEFAULT_SPEC.name });
    name = DEFAULT_SPEC.name;
  }
  const features = Array.isArray(o.features)
    ? o.features
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        .map((f) => f.trim().slice(0, LIMITS.features.itemMax))
        .slice(0, LIMITS.features.max)
    : [];
  if (!Array.isArray(o.features) || features.length !== o.features.length) {
    log.push({ path: "features", from: o.features, to: features });
  }
  const inputs = enumList(INPUTS, o.inputs, "inputs", log);
  // "none" next to a real input means nothing.
  const cleanInputs = inputs.length > 1 ? inputs.filter((i) => i !== "none") : inputs;
  if (o.quantity !== undefined && o.quantity !== 1) log.push({ path: "quantity", from: o.quantity, to: 1 });
  const use = pickEnum(USES, o.use, DEFAULT_SPEC.use, "use", log);
  const rawPlacement = typeof o.placement === "string" ? o.placement.trim().toLowerCase() : "";
  const placement = rawPlacement ? (PLACEMENTS as readonly string[]).find((p) => p === rawPlacement) : undefined;
  if (o.placement !== undefined && o.placement !== null && o.placement !== "" && !placement) log.push({ path: "placement", from: o.placement, to: null });
  const scaleNote = typeof o.scaleNote === "string" && o.scaleNote.trim() ? clampStr(o.scaleNote, LIMITS.scaleNote.max, "", "scaleNote", log) : "";
  const actuators = clampActuators(o.actuators, log);
  const understanding = clampUnderstanding(o.understanding, log);
  // clampSpec rebuilds the spec field by field, so a field missing from this
  // list is silently dropped. buildClass MUST survive: losing it turns a
  // "no microcontroller" build back into an mcu one, which is the exact bug
  // this field exists to stop. Absent stays absent (older cards read as mcu).
  const rawClass = typeof o.buildClass === "string" ? o.buildClass.trim().toLowerCase() : "";
  const buildClass = rawClass ? (BUILD_CLASSES as readonly string[]).find((c) => c === rawClass) : undefined;
  if (o.buildClass !== undefined && o.buildClass !== null && o.buildClass !== "" && !buildClass) {
    log.push({ path: "buildClass", from: o.buildClass, to: null });
  }
  return {
    name,
    oneLine: typeof o.oneLine === "string" && o.oneLine.trim() ? clampStr(o.oneLine, LIMITS.oneLine.max, "", "oneLine", log) : "",
    use,
    power: pickEnum(POWERS, o.power, DEFAULT_SPEC.power, "power", log),
    environment: pickEnum(ENVIRONMENTS, o.environment, use === "outdoor" ? "outdoor" : "indoor", "environment", log),
    features,
    inputs: cleanInputs,
    outputs: enumList(OUTPUTS, o.outputs, "outputs", log),
    sizeHint: pickEnum(SIZE_HINTS, o.sizeHint, DEFAULT_SPEC.sizeHint, "sizeHint", log),
    style: pickEnum(STYLES, o.style, DEFAULT_SPEC.style, "style", log),
    ...(placement ? { placement: placement as Placement } : {}),
    ...(scaleNote ? { scaleNote } : {}),
    ...(actuators.length ? { actuators } : {}),
    ...(understanding ? { understanding } : {}),
    ...(buildClass ? { buildClass: buildClass as BuildClass } : {}),
    quantity: 1,
  };
}

/** Any value → a valid Understanding, or undefined when there is nothing usable. */
export function clampUnderstanding(v: unknown, log: ClampLog = []): Understanding | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) {
    log.push({ path: "understanding", from: v, to: null });
    return undefined;
  }
  const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const part = (x: unknown): UnderstandingPart | null => {
    if (!isObj(x)) return null;
    const name = text(x.name, U.name);
    if (!name) return null;
    const n = Math.round(Number(x.count));
    const purpose = text(x.purpose, U.purpose);
    return { name, count: Number.isFinite(n) ? Math.min(U.countMax, Math.max(1, n)) : 1, ...(purpose ? { purpose } : {}) };
  };
  const list = (x: unknown, path: string): UnderstandingPart[] => {
    if (!Array.isArray(x)) return [];
    const out = x.map(part).filter((p): p is UnderstandingPart => p !== null).slice(0, U.items);
    if (out.length !== x.length) log.push({ path: `understanding.${path}`, from: x.length, to: out.length });
    return out;
  };
  const movers: UnderstandingMover[] = Array.isArray(v.actuators)
    ? v.actuators
        .map((x) => {
          const p = part(x);
          if (!p || !isObj(x)) return null;
          const raw = typeof x.kind === "string" ? x.kind.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
          const kind = (MOVER_KINDS as readonly string[]).includes(raw)
            ? (raw as MoverKind)
            : /linear/.test(raw) || /linear/i.test(p.name)
              ? "linear_actuator"
              : /pump/.test(raw)
                ? "pump"
                : /stepper/.test(raw)
                  ? "stepper"
                  : /motor/.test(raw)
                    ? "motor"
                    : "servo";
          return { ...p, kind };
        })
        .filter((p): p is UnderstandingMover => p !== null)
        .slice(0, U.items)
    : [];
  const goal = text(v.goal, U.goal);
  const howItWorks = text(v.howItWorks, U.how);
  const controller = text(v.controller, U.name);
  const sensors = list(v.sensors, "sensors");
  const outputs = list(v.outputs, "outputs");
  if (!goal && !howItWorks && !controller && !sensors.length && !movers.length && !outputs.length) return undefined;
  return { goal, howItWorks, controller, sensors, actuators: movers, outputs };
}

export type ClampEnclosureOpts = {
  /** Templates the renderer can build right now (defaults to all). */
  templates?: readonly EnclosureTemplate[];
  /** Footprint of the layout (mm) — enforces cornerRadius ≤ 0.33·min(W,D). */
  footprint?: { w: number; d: number };
};

/** Any value → a valid EnclosureSpec. Every change goes to `log`. */
export function clampEnclosure(input: unknown, log: ClampLog = [], opts: ClampEnclosureOpts = {}): EnclosureSpec {
  const o = isObj(input) ? input : {};
  if (!isObj(input)) log.push({ path: "enclosure", from: input, to: "default" });
  const d = DEFAULT_ENCLOSURE;
  const allowed = opts.templates ?? ENCLOSURE_TEMPLATES;
  let template = pickEnum(ENCLOSURE_TEMPLATES, o.template, d.template, "template", log);
  if (!allowed.includes(template)) {
    log.push({ path: "template", from: template, to: d.template });
    template = d.template;
  }
  const p = isObj(o.proportions) ? o.proportions : {};
  const wall = clampNum(o.wall, LIMITS.wall.min, LIMITS.wall.max, d.wall, "wall", log);
  // edgeFillet ≤ 0.4·wall·2 (so the fillet never eats the wall).
  const filletMax = Math.max(LIMITS.edgeFillet.min, Math.min(LIMITS.edgeFillet.max, 0.8 * wall));
  const edgeFillet = clampNum(o.edgeFillet, LIMITS.edgeFillet.min, filletMax, Math.min(d.edgeFillet, filletMax), "edgeFillet", log);
  let radiusMax: number = LIMITS.cornerRadius.max;
  if (opts.footprint) {
    radiusMax = Math.max(LIMITS.cornerRadius.min, Math.min(radiusMax, 0.33 * Math.min(opts.footprint.w, opts.footprint.d)));
  }
  const cornerRadius = clampNum(o.cornerRadius, LIMITS.cornerRadius.min, radiusMax, Math.min(d.cornerRadius, radiusMax), "cornerRadius", log);
  let lid = pickEnum(LIDS, o.lid, d.lid, "lid", log);
  if (lid === "twist" && template !== "puck") {
    log.push({ path: "lid", from: lid, to: "snap" });
    lid = "snap";
  }
  const v = isObj(o.vents) ? o.vents : {};
  const ventPattern = pickEnum(VENT_PATTERNS, v.pattern, "none", "vents.pattern", log);
  const ventCount = ventPattern === "none"
    ? 0
    : clampNum(v.count, LIMITS.ventCount.min, LIMITS.ventCount.max, 8, "vents.count", log, { int: true });
  let ventFace = pickEnum(VENT_FACES, v.face, "-z", "vents.face", log);
  if (ventPattern === "louvres" && !(SIDE_VENT_FACES as readonly string[]).includes(ventFace)) {
    log.push({ path: "vents.face", from: ventFace, to: "+x" });
    ventFace = "+x";
  }
  if (template === "stake_pod" && ventPattern !== "none" && ventFace === "-z") {
    // The pod's bottom holds the spike socket and sits over wet soil: vents go on a side.
    log.push({ path: "vents.face", from: ventFace, to: "+x" });
    ventFace = "+x";
  }
  let feet = pickEnum(FEET, o.feet, d.feet, "feet", log);
  if ((template === "wall_plate" || template === "stake_pod") && feet !== "none") {
    // A wall plate hangs on the wall and a stake pod stands on its spike: no feet.
    log.push({ path: "feet", from: feet, to: "none" });
    feet = "none";
  }
  const out: EnclosureSpec = {
    template,
    proportions: {
      widthToDepth: clampNum(p.widthToDepth, LIMITS.widthToDepth.min, LIMITS.widthToDepth.max, d.proportions.widthToDepth, "proportions.widthToDepth", log),
      heightBias: pickEnum(HEIGHT_BIASES, p.heightBias, d.proportions.heightBias, "proportions.heightBias", log),
    },
    cornerRadius,
    edgeFillet,
    wall,
    clearance: clampNum(o.clearance, LIMITS.clearance.min, LIMITS.clearance.max, d.clearance, "clearance", log),
    lid,
    vents: { pattern: ventPattern, face: ventFace, count: ventCount },
    feet,
    finish: pickEnum(FINISHES, o.finish, d.finish, "finish", log),
    colour: pickEnum(COLOURS, o.colour, d.colour, "colour", log),
  };
  if (o.accentColour !== undefined && o.accentColour !== null) {
    const a = pickEnum(COLOURS, o.accentColour, out.colour, "accentColour", log);
    if (a !== out.colour) out.accentColour = a;
  }
  if (typeof o.label === "string" && o.label.trim()) {
    out.label = clampStr(o.label, LIMITS.label.max, "", "label", log);
    if (!out.label) delete out.label;
  }
  return out;
}

/** Any value → a valid MechPart (or null when the template is unknown). */
export function clampMechPart(input: unknown, log: ClampLog = [], idx = 0): MechPart | null {
  if (!isObj(input)) {
    log.push({ path: `mech[${idx}]`, from: input, to: null });
    return null;
  }
  const tpl = typeof input.template === "string" ? input.template.trim().toLowerCase() : "";
  if (!(MECH_TEMPLATES as readonly string[]).includes(tpl)) {
    log.push({ path: `mech[${idx}].template`, from: input.template, to: null });
    return null;
  }
  const template = tpl as MechTemplate;
  const ranges = MECH_PARAMS[template];
  const raw = isObj(input.params) ? input.params : {};
  const params: Record<string, number> = {};
  for (const [k, [min, max, def]] of Object.entries(ranges)) {
    params[k] = clampNum(raw[k], min, max, def, `mech[${idx}].params.${k}`, log);
  }
  const pr = isObj(input.printable) ? input.printable : {};
  // MATERIALS are upper-case, so pickEnum (which lower-cases) can never match them.
  const matIn = typeof pr.material === "string" ? pr.material.trim().toUpperCase() : "";
  const material = MATERIALS.find((m) => m === matIn) ?? "PLA";
  if (material !== pr.material) log.push({ path: `mech[${idx}].printable.material`, from: pr.material, to: material });
  const out: MechPart = {
    id: typeof input.id === "string" && /^[\w-]{1,40}$/.test(input.id) ? input.id : `${template}_${idx + 1}`,
    template,
    params,
    printable: { material, estGrams: clampNum(pr.estGrams, 0, 2000, 5, `mech[${idx}].printable.estGrams`, log) },
  };
  if (typeof input.forInstance === "string" && input.forInstance) out.forInstance = input.forInstance;
  return out;
}

export function clampMechParts(input: unknown, log: ClampLog = []): MechPart[] {
  if (!Array.isArray(input)) {
    log.push({ path: "mech", from: input, to: [] });
    return [];
  }
  const seen = new Set<string>();
  const out: MechPart[] = [];
  input.slice(0, 40).forEach((m, i) => {
    const part = clampMechPart(m, log, i);
    if (!part) return;
    let id = part.id;
    let n = 2;
    while (seen.has(id)) id = `${part.id}_${n++}`;
    seen.add(id);
    out.push({ ...part, id });
  });
  return out;
}
