// Zod schemas for a VALID Studio document (what projects.studio stores and the
// renderer accepts). Import from "./schema".

import { z } from "zod";

// Type-only (erased): product/schema.ts imports the schema barrel, a value import would be a cycle.
import type { Archetype } from "./product/archetype-names";
import {
  ACTUATOR_KINDS, ACTUATOR_LOADS, BUILD_CLASSES, CATEGORIES, COLOURS, ENCLOSURE_TEMPLATES,
  ENVIRONMENTS, FACES, FEET, FINISHES, HEIGHT_BIASES, INPUTS, LIDS, LIMITS, LOOKS, MATERIALS,
  MECH_TEMPLATES, MOVER_KINDS, OUTPUTS, PIN_ROLES, PIN_SIDES, PLACEMENTS, PORT_KINDS, POWERS,
  SIZE_HINTS, STYLES, USES, VENT_FACES, VENT_PATTERNS,
} from "./schema-enums";

// ---------------------------------------------------------------------------
// ProductSpec
// ---------------------------------------------------------------------------

/** Part B: one group of identical movers, e.g. {kind: "servo", count: 6, load: "medium", role: "arm joints"}. */
export const ActuatorSchema = z.object({
  kind: z.enum(ACTUATOR_KINDS),
  count: z.number().int().min(LIMITS.actuators.countMin).max(LIMITS.actuators.countMax),
  load: z.enum(ACTUATOR_LOADS),
  role: z.string().max(LIMITS.actuators.roleMax).optional(),
});
export type Actuator = z.infer<typeof ActuatorSchema>;

/** One line of the understanding's parts list: "Soil moisture sensor ×2 — tells when the pot is dry". */
const U = LIMITS.understanding;
export const UnderstandingPartSchema = z.object({
  name: z.string().min(1).max(U.name),
  count: z.number().int().min(1).max(U.countMax),
  purpose: z.string().max(U.purpose).optional(),
});
export const UnderstandingMoverSchema = UnderstandingPartSchema.extend({ kind: z.enum(MOVER_KINDS) });

/**
 * The agent's full understanding of the idea (2026-10-18), rebuilt on every chat turn and
 * shown above the chat so the user can confirm it. Tiers are counted from it (lib/studio/tiers.ts).
 */
export const UnderstandingSchema = z.object({
  goal: z.string().max(U.goal),
  howItWorks: z.string().max(U.how),
  /** The one controller board. Empty on a logic / cad build, which has none. */
  controller: z.string().max(U.name),
  sensors: z.array(UnderstandingPartSchema).max(U.items),
  actuators: z.array(UnderstandingMoverSchema).max(U.items),
  outputs: z.array(UnderstandingPartSchema).max(U.items),
});
export type Understanding = z.infer<typeof UnderstandingSchema>;
export type UnderstandingPart = z.infer<typeof UnderstandingPartSchema>;
export type UnderstandingMover = z.infer<typeof UnderstandingMoverSchema>;

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
  placement: z.enum(PLACEMENTS).optional(),
  /** Set only when the idea is far beyond a desktop kit (industrial robot, car…): what we build instead. */
  scaleNote: z.string().max(LIMITS.scaleNote.max).optional(),
  /** Part B: how many motors / servos / pumps, when it is more than "one of something" (max 4 groups). */
  actuators: z.array(ActuatorSchema).max(LIMITS.actuators.max).optional(),
  /** 2026-10-18: the "Our understanding" panel. Absent on cards made before it. */
  understanding: UnderstandingSchema.optional(),
  /**
   * 2026-10-20: what kind of build this is. Absent on cards made before it, which
   * are read as "mcu" (buildClassOf() in lib/studio/build-class.ts). The user can
   * override what the agent chose, so this is the stored answer, not a guess.
   */
  buildClass: z.enum(BUILD_CLASSES).optional(),
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

/** Optional hand-tuned 2D wiring drawing (P5-17); everything is derived from pins/dims when absent (lib/studio/drawing2d.ts). */
export const Drawing2DOverrideSchema = z.object({
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  colour: z.string().optional(),
  decor: z.enum(["none", "chip", "screen", "led", "resistor", "ring"]).optional(),
  /** Which edge each pin sits on in the drawing. */
  edges: z.record(z.string(), z.enum(["left", "right"])).optional(),
});

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
    /** Part D: power SOURCES only — the most current (mA) this supply can give (psu_5v_5a 5000). */
    supplyMA: z.number().positive().optional(),
  }),
  requires: z.array(z.object({ id: z.string(), reason: z.string() })).optional(),
  clearance: z.number().nonnegative(),
  /** Internal helper parts (resistor, level shifter) are hidden from the picker and never shown as "a part to choose". */
  helper: z.boolean().optional(),
  /** 3D wiring: explicit pin positions on the model (mm, Z up, part frame) where lib/studio/wiring3d/pins3d.ts derives them wrong. */
  pins3d: z.record(z.string(), z.tuple([z.number(), z.number(), z.number()])).optional(),
  /** 2D wiring drawing overrides (P5-17); lib/studio/drawing2d.ts derives everything else from pins/dims. */
  drawing2d: z
    .object({
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
      colour: z.string().optional(),
      decor: z.enum(["none", "chip", "screen", "led", "resistor", "ring"]).optional(),
      /** Which edge each pin sits on in the drawing. */
      edges: z.record(z.string(), z.enum(["left", "right"])).optional(),
    })
    .optional(),
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

export const StudioComponentSchema = z.object({
  partId: z.string(),
  instanceId: z.string(),
  label: z.string(),
  /** One plain sentence on why this part is here (from the picker or the rules). */
  reason: z.string().optional(),
  /** Added automatically by the rules (resistor, level shifter…), not by the picker. */
  auto: z.boolean().optional(),
  /** The part's colour when it is sold in colours (lib/studio/variants.ts), e.g. a green LED. */
  variant: z.string().max(20).optional(),
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

// ---------------------------------------------------------------------------
// Product designs (P5-16) — the PAGE-SAFE part only
// ---------------------------------------------------------------------------
// Pictures + public metadata. The ProductModels themselves live server-side in
// projects.studio.productPrivate (lib/studio/product/private.ts): never in this
// schema, so every doc parse strips them, and the server owns this field too —
// a doc save from the page keeps the stored `product` (lib/studio/server/doc.ts).

export const PRODUCT_DESIGN_STATUSES = ["building", "ready", "failed"] as const;

/** Design ids are minted by the server: d_ + 10 base-36 chars. */
export const PRODUCT_DESIGN_ID = /^d_[a-z0-9]{6,16}$/;
/** At most this many designs are kept on a project (oldest unchosen ones drop first). */
export const PRODUCT_DESIGNS_MAX = 9;

/** An archetype name (the list lives in product/schema.ts; the server only writes real ones). */
const ArchetypeName = z.custom<Archetype>((v) => typeof v === "string" && /^[a-z_]{3,32}$/.test(v), "archetype");

export const ProductDesignSchema = z.object({
  id: z.string().regex(PRODUCT_DESIGN_ID),
  archetype: ArchetypeName,
  why: z.object({ en: z.string().max(160), ar: z.string().max(160) }),
  /** Storage path of the chosen 3/4 picture (bucket project-images), or null before it is rendered. */
  previewPath: z.string().max(200).nullable(),
  status: z.enum(PRODUCT_DESIGN_STATUSES),
});
export type ProductDesign = z.infer<typeof ProductDesignSchema>;

export const ProductDocSchema = z.object({
  designs: z.array(ProductDesignSchema).max(PRODUCT_DESIGNS_MAX),
  chosenId: z.string().nullable(),
  unlockedId: z.string().nullable(),
  /** Hash of the spec + parts the designs were made for (a new spec starts a new set). */
  specHash: z.string().max(64),
  /** Regenerations (new sets of 3 from "Try another" / feedback) made so far; the first is free, later ones cost ideation tokens. Server-owned. */
  regens: z.number().int().min(0).max(1000).optional(),
});
export type ProductDoc = z.infer<typeof ProductDocSchema>;

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
  /** The step the visitor was last on (W1): the Studio reopens there. Loose string so a renamed step never breaks old docs. */
  lastStep: z.string().max(32).optional(),
  /** P5-16 product designs: pictures + public metadata only (server-owned, see ProductDocSchema). */
  product: ProductDocSchema.optional(),
  /** P5-17 pin-list checklist: connectionKey() of every wire the client ticked while wiring. */
  wiringTicks: z.array(z.string().max(120)).max(300).optional(),
});
export type StudioDoc = z.infer<typeof StudioDocSchema>;
/** Page-side names for the same types (P5-16 Phase 2b). */
export type StudioProduct = ProductDoc;
export type StudioProductDesign = ProductDesign;
