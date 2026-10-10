// Design Studio data formats — the single source of truth (all units mm, Z up).
//
// Two layers:
//  * zod schemas describe a VALID document (what we store in projects.studio
//    and what the renderer accepts);
//  * clamp*() helpers turn ANY value (usually AI JSON) into a valid one: bad
//    enums fall back to safe defaults, numbers are clamped to their ranges, and
//    every change is recorded in a ClampLog for admin (never shown to clients).
//
// The AI never writes geometry: it only fills these small objects. The same
// JSON is meant to feed a future CadQuery backend unchanged (lib/studio/cad-adapter.ts).

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const USES = ["desk", "handheld", "wall", "wearable", "outdoor", "vehicle"] as const;
export const POWERS = ["usb", "battery", "battery_usb", "mains_adapter"] as const;
export const ENVIRONMENTS = ["indoor", "outdoor"] as const;
export const INPUTS = ["button", "touch", "knob", "none"] as const;
export const OUTPUTS = ["screen", "led", "buzzer", "speaker", "motor", "relay"] as const;
export const SIZE_HINTS = ["pocket", "palm", "desk", "large"] as const;
export const STYLES = ["rounded", "soft_tech", "rugged", "minimal"] as const;

export const CATEGORIES = [
  "mcu", "power", "sensor", "display", "input", "output", "actuator", "connector",
] as const;
export const LOOKS = [
  "pcb_green", "pcb_black", "pcb_blue", "metal", "plastic_black", "plastic_white", "battery_wrap",
] as const;
export const PORT_KINDS = [
  "usb_c", "usb_micro", "usb_b", "dc_jack", "sensor_window", "display_window",
  "button_cap", "led_light_pipe", "speaker_grille",
] as const;
export const FACES = ["+x", "-x", "+y", "-y", "+z"] as const;
export const VENT_FACES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;
export const PIN_ROLES = [
  "vin", "3v3", "5v", "gnd", "gpio", "adc", "pwm", "i2c_sda", "i2c_scl",
  "spi_mosi", "spi_miso", "spi_sck", "spi_cs", "uart_tx", "uart_rx", "out", "in",
] as const;
export const PIN_SIDES = ["left", "right", "top", "bottom"] as const;

/** All eight enclosure templates (lantern / dome_base / wall_plate since Phase 3). */
export const ENCLOSURE_TEMPLATES = [
  "rounded_box", "pill", "soft_wedge", "puck", "handheld_taper",
  "lantern", "dome_base", "wall_plate",
] as const;
export const HEIGHT_BIASES = ["low", "mid", "tall"] as const;
export const LIDS = ["snap", "screw_4", "slide", "twist"] as const;
/** grille = concentric arcs (speakers); louvres = angled slats on a SIDE face. */
export const VENT_PATTERNS = ["none", "slots", "holes", "hex", "grille", "louvres"] as const;
/** Faces where louvres make sense (side walls). */
export const SIDE_VENT_FACES = ["+x", "-x", "+y", "-y"] as const;
export const FEET = ["none", "rubber_4", "ring"] as const;
export const FINISHES = [
  "matte_plastic", "glossy_plastic", "soft_touch", "anodized_aluminium", "wood_look",
] as const;

/** Enclosure colour palette (names only; hex lives in lib/studio/palette.ts). */
export const COLOURS = [
  "chalk", "graphite", "sand", "sage", "coral", "ocean", "sun", "cobalt", "mist", "clay",
] as const;

export const MECH_TEMPLATES = [
  "standoff", "pcb_cradle", "battery_clip", "sensor_mount", "cable_clip",
  "button_extender", "light_pipe", "wall_bracket", "lid", "base",
] as const;
export const MATERIALS = ["PLA", "PETG", "TPU"] as const;

export type Use = (typeof USES)[number];
export type Power = (typeof POWERS)[number];
export type Environment = (typeof ENVIRONMENTS)[number];
export type Input = (typeof INPUTS)[number];
export type Output = (typeof OUTPUTS)[number];
export type SizeHint = (typeof SIZE_HINTS)[number];
export type Style = (typeof STYLES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Look = (typeof LOOKS)[number];
export type PortKind = (typeof PORT_KINDS)[number];
export type Face = (typeof FACES)[number];
export type VentFace = (typeof VENT_FACES)[number];
export type PinRole = (typeof PIN_ROLES)[number];
export type EnclosureTemplate = (typeof ENCLOSURE_TEMPLATES)[number];
export type Finish = (typeof FINISHES)[number];
export type Colour = (typeof COLOURS)[number];
export type MechTemplate = (typeof MECH_TEMPLATES)[number];

// ---------------------------------------------------------------------------
// Ranges (shared by schema + clamp + the AI responseSchema descriptions)
// ---------------------------------------------------------------------------

export const LIMITS = {
  name: { min: 3, max: 40 },
  oneLine: { max: 120 },
  features: { max: 8, itemMax: 60 },
  widthToDepth: { min: 0.5, max: 2.5 },
  cornerRadius: { min: 3, max: 20 },
  edgeFillet: { min: 1, max: 6 },
  wall: { min: 1.6, max: 4 },
  clearance: { min: 1, max: 4 },
  ventCount: { min: 0, max: 24 },
  label: { max: 16 },
  /** Footprint never thinner than this (design rule). */
  minFootprint: 15,
  /** Height never > this × the smaller footprint side (except lantern). */
  maxHeightRatio: 2,
  /** Lid lip (mm) between base and lid. */
  lidLip: 0.4,
} as const;

// ---------------------------------------------------------------------------
// ProductSpec
// ---------------------------------------------------------------------------

export const ProductSpecSchema = z.object({
  name: z.string().min(LIMITS.name.min).max(LIMITS.name.max),
  oneLine: z.string().max(LIMITS.oneLine.max),
  use: z.enum(USES),
  power: z.enum(POWERS),
  environment: z.enum(ENVIRONMENTS),
  features: z.array(z.string().max(LIMITS.features.itemMax)).max(LIMITS.features.max),
  inputs: z.array(z.enum(INPUTS)),
  outputs: z.array(z.enum(OUTPUTS)),
  sizeHint: z.enum(SIZE_HINTS),
  style: z.enum(STYLES),
  quantity: z.literal(1),
});
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

// ---------------------------------------------------------------------------
// LibraryPart
// ---------------------------------------------------------------------------

const Vec3Dims = z.object({ x: z.number().positive(), y: z.number().positive(), z: z.number().positive() });

export const PartModelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("procedural"), builder: z.string(), params: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("stl"), url: z.string() }),
]);

export const PortSchema = z.object({
  kind: z.enum(PORT_KINDS),
  face: z.enum(FACES),
  /** Position on the face, 0..1 in face-local (u, v) — u along the face's first axis, v along Z (or Y for +z). */
  at: z.object({ u: z.number().min(0).max(1), v: z.number().min(0).max(1) }),
  /** Opening size in mm (w along u, h along v). */
  size: z.object({ w: z.number().positive(), h: z.number().positive() }),
});
export type Port = z.infer<typeof PortSchema>;

export const PinSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.enum(PIN_ROLES),
  voltage: z.number().optional(),
  side: z.enum(PIN_SIDES).optional(),
});
export type Pin = z.infer<typeof PinSchema>;

export const LibraryPartSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.object({ en: z.string(), ar: z.string() }),
  /** One plain sentence on what it does (EN/AR), shown in the parts list and on tap. */
  blurb: z.object({ en: z.string(), ar: z.string() }),
  category: z.enum(CATEGORIES),
  storeSkus: z.array(z.string()),
  tags: z.array(z.string()),
  dims: Vec3Dims,
  model: PartModelSchema,
  look: z.object({ body: z.enum(LOOKS), accent: z.string().optional() }),
  mount: z.object({
    holes: z.array(z.object({ x: z.number(), y: z.number(), d: z.number().positive() })),
    standoffHeight: z.number().nonnegative(),
  }).nullable(),
  ports: z.array(PortSchema),
  pins: z.array(PinSchema),
  power: z.object({
    vMin: z.number(),
    vMax: z.number(),
    logicV: z.union([z.literal(3.3), z.literal(5)]),
    mA: z.number().nonnegative(),
  }),
  requires: z.array(z.object({ id: z.string(), reason: z.string() })).optional(),
  clearance: z.number().nonnegative(),
  /** Internal helper parts (resistor, level shifter) are hidden from the picker and never shown as "a part to choose". */
  helper: z.boolean().optional(),
});
export type LibraryPart = z.infer<typeof LibraryPartSchema>;

// ---------------------------------------------------------------------------
// EnclosureSpec — the ONLY thing the AI outputs for the enclosure
// ---------------------------------------------------------------------------

export const EnclosureSpecSchema = z.object({
  template: z.enum(ENCLOSURE_TEMPLATES),
  proportions: z.object({
    widthToDepth: z.number().min(LIMITS.widthToDepth.min).max(LIMITS.widthToDepth.max),
    heightBias: z.enum(HEIGHT_BIASES),
  }),
  cornerRadius: z.number().min(LIMITS.cornerRadius.min).max(LIMITS.cornerRadius.max),
  edgeFillet: z.number().min(LIMITS.edgeFillet.min).max(LIMITS.edgeFillet.max),
  wall: z.number().min(LIMITS.wall.min).max(LIMITS.wall.max),
  clearance: z.number().min(LIMITS.clearance.min).max(LIMITS.clearance.max),
  lid: z.enum(LIDS),
  vents: z.object({
    pattern: z.enum(VENT_PATTERNS),
    face: z.enum(VENT_FACES),
    count: z.number().int().min(LIMITS.ventCount.min).max(LIMITS.ventCount.max),
  }),
  feet: z.enum(FEET),
  finish: z.enum(FINISHES),
  colour: z.enum(COLOURS),
  accentColour: z.enum(COLOURS).optional(),
  label: z.string().max(LIMITS.label.max).optional(),
});
export type EnclosureSpec = z.infer<typeof EnclosureSpecSchema>;

// ---------------------------------------------------------------------------
// MechPart (Phase 2)
// ---------------------------------------------------------------------------

export const MechPartSchema = z.object({
  id: z.string(),
  template: z.enum(MECH_TEMPLATES),
  params: z.record(z.string(), z.number()),
  forInstance: z.string().optional(),
  printable: z.object({ material: z.enum(MATERIALS), estGrams: z.number().nonnegative() }),
});
export type MechPart = z.infer<typeof MechPartSchema>;

// ---------------------------------------------------------------------------
// StudioDoc — stored in projects.studio
// ---------------------------------------------------------------------------

export const ROT_Z = [0, 90, 180, 270] as const;

export const StudioComponentSchema = z.object({
  partId: z.string(),
  instanceId: z.string(),
  label: z.string(),
  /** One plain sentence on why this part is here (from the picker or the rules). */
  reason: z.string().optional(),
  /** Added automatically by the rules (resistor, level shifter…), not by the picker. */
  auto: z.boolean().optional(),
});
export type StudioComponent = z.infer<typeof StudioComponentSchema>;

export const NetSchema = z.object({ name: z.string(), pins: z.array(z.string()) });
export type Net = z.infer<typeof NetSchema>;

export const CheckSchema = z.object({ id: z.string(), ok: z.boolean(), plain: z.string() });
export type StudioCheck = z.infer<typeof CheckSchema>;

export const LayoutItemSchema = z.object({
  instanceId: z.string(),
  pos: z.tuple([z.number(), z.number(), z.number()]),
  rotZ: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const StudioDocSchema = z.object({
  version: z.literal(1),
  spec: ProductSpecSchema,
  components: z.array(StudioComponentSchema),
  netlist: z.object({ nets: z.array(NetSchema) }),
  checks: z.array(CheckSchema),
  enclosure: EnclosureSpecSchema.nullable(),
  /** Up to 3 enclosure versions ("Try another look"); `enclosure` is the one shown. */
  enclosureVersions: z.array(EnclosureSpecSchema).max(3).optional(),
  layout: z.array(LayoutItemSchema),
  mech: z.array(MechPartSchema),
  firmware: z.object({ board: z.string(), code: z.string() }).optional(),
  /** Idea chat answers already given — never asked again by a later step. */
  answers: z.record(z.string(), z.string()).optional(),
});
export type StudioDoc = z.infer<typeof StudioDocSchema>;

// ---------------------------------------------------------------------------
// Clamp helpers
// ---------------------------------------------------------------------------

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

export const DEFAULT_SPEC: ProductSpec = {
  name: "My product",
  oneLine: "",
  use: "desk",
  power: "usb",
  environment: "indoor",
  features: [],
  inputs: [],
  outputs: [],
  sizeHint: "palm",
  style: "rounded",
  quantity: 1,
};

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
    quantity: 1,
  };
}

export const DEFAULT_ENCLOSURE: EnclosureSpec = {
  template: "rounded_box",
  proportions: { widthToDepth: 1.4, heightBias: "mid" },
  cornerRadius: 8,
  edgeFillet: 2,
  wall: 2,
  clearance: 2,
  lid: "snap",
  vents: { pattern: "none", face: "-z", count: 0 },
  feet: "none",
  finish: "matte_plastic",
  colour: "chalk",
};

/** Templates allowed for the current phase (renderer can build these). */
export const PHASE_TEMPLATES: readonly EnclosureTemplate[] = [
  "rounded_box", "pill", "soft_wedge", "puck", "handheld_taper", "lantern", "dome_base", "wall_plate",
];

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
  let feet = pickEnum(FEET, o.feet, d.feet, "feet", log);
  if (template === "wall_plate" && feet !== "none") {
    // A wall plate hangs on the wall: no feet.
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

/**
 * Through-lid printed parts (mm). Button extender profile, bottom → top: a flange
 * (FLANGE) on the button, a shaft of `length`, then the cap (CAP_T) in the lid
 * opening, its top PROUD above the lid's outer surface. A light pipe ends PROUD
 * above the lid (flush). mech/place.ts fits `length` to the real gap.
 */
export const THROUGH_LID = {
  extender: { flange: 1, capT: 2.5, proud: 1, minOpening: 8 },
  lightPipe: { proud: 0.15 },
  /** Radial play of a cap / pipe in its lid opening. */
  play: 0.3,
} as const;

/** Per-template parameter ranges for printable parts: [min, max, default]. */
export const MECH_PARAMS: Record<MechTemplate, Record<string, [number, number, number]>> = {
  standoff: { height: [2, 25, 6], outerD: [4, 10, 6], holeD: [1.6, 3.4, 2.5] },
  pcb_cradle: { width: [10, 120, 30], depth: [10, 120, 50], railHeight: [2, 10, 4], wall: [1.2, 3, 1.6] },
  battery_clip: { cellD: [10, 22, 18.6], length: [30, 75, 65], wall: [1.2, 3, 1.8] },
  sensor_mount: { width: [8, 60, 25], height: [8, 60, 25], tilt: [0, 45, 0], wall: [1.2, 3, 1.6] },
  cable_clip: { cableD: [2, 10, 4], width: [4, 15, 8] },
  button_extender: { capD: [4, 14, 8], length: [2, 20, 6] },
  light_pipe: { d: [2, 8, 3], length: [2, 25, 8] },
  wall_bracket: { width: [20, 150, 60], height: [20, 150, 40], holeD: [3, 6, 4], thickness: [2, 5, 3] },
  lid: { width: [15, 300, 60], depth: [15, 300, 40], thickness: [1.6, 4, 2] },
  base: { width: [15, 300, 60], depth: [15, 300, 40], height: [10, 200, 30] },
};

/** Grams of PLA (density 1.24) for a volume in mm³, at ~35 % effective fill. */
export function estGrams(volumeMm3: number, material: (typeof MATERIALS)[number] = "PLA"): number {
  const density = material === "TPU" ? 1.21 : material === "PETG" ? 1.27 : 1.24;
  return Math.max(1, Math.round((volumeMm3 / 1000) * density * 0.35));
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

export function emptyStudioDoc(spec: ProductSpec = DEFAULT_SPEC): StudioDoc {
  return {
    version: 1,
    spec,
    components: [],
    netlist: { nets: [] },
    checks: [],
    enclosure: null,
    layout: [],
    mech: [],
  };
}

/** Parse a stored projects.studio value; anything unreadable → null (caller starts fresh). */
export function parseStudioDoc(v: unknown): StudioDoc | null {
  const r = StudioDocSchema.safeParse(v);
  return r.success ? r.data : null;
}
