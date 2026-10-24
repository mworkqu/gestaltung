// Defaults and fixed tables for a Studio document, plus the doc constructor and
// parser. Import from "./schema".

import {
  type EnclosureTemplate, type MATERIALS, type MechTemplate,
} from "./schema-enums";
import {
  StudioDocSchema, type EnclosureSpec, type ProductSpec, type StudioDoc,
} from "./schema-zod";
import { gramsFromVolume } from "./weight";

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
  "rounded_box", "pill", "soft_wedge", "puck", "handheld_taper", "lantern", "dome_base", "wall_plate", "stake_pod",
];

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
  // F-005: the clip follows the BATTERY. `flat` 1 = a pouch cell (LiPo) gets a
  // flat retainer sized by `cellW` x `cellT`; 0 = a round cell gets a cradle
  // sized by `cellD`. A cradle can never hold a pouch, which is what shipped.
  battery_clip: { cellD: [10, 22, 18.6], length: [30, 75, 65], wall: [1.2, 3, 1.8], cellW: [8, 60, 18.6], cellT: [2, 12, 6], flat: [0, 1, 0] },
  sensor_mount: { width: [8, 60, 25], height: [8, 60, 25], tilt: [0, 45, 0], wall: [1.2, 3, 1.6] },
  cable_clip: { cableD: [2, 10, 4], width: [4, 15, 8] },
  button_extender: { capD: [4, 14, 8], length: [2, 20, 6] },
  light_pipe: { d: [2, 8, 3], length: [2, 25, 8] },
  wall_bracket: { width: [20, 150, 60], height: [20, 150, 40], holeD: [3, 6, 4], thickness: [2, 5, 3] },
  lid: { width: [15, 300, 60], depth: [15, 300, 40], thickness: [1.6, 4, 2] },
  base: { width: [15, 300, 60], depth: [15, 300, 40], height: [10, 200, 30] },
};

/**
 * Grams of a printed body from its MESH volume. Thin alias so older call sites
 * keep working: the one calculation lives in lib/studio/weight.ts (F-004).
 * There is no infill factor — a Studio body is already a hollow shell.
 */
export function estGrams(volumeMm3: number, material: (typeof MATERIALS)[number] = "PLA"): number {
  return gramsFromVolume(volumeMm3, material);
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
