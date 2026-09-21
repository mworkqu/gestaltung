// Prototyping reference data: the processes we can actually route a part to,
// the materials we can get, and which pairs are real.
//
// This is the single source of truth for both the UI pickers and the rules
// engine. Labels are translated through the Prototyping.* message keys, never
// stored — the DB holds these plain keys.

export const PROCESSES = [
  "3d_printing",
  "cnc_machining",
  "laser_cutting",
  "pcb_manufacturing",
  "edm",
] as const;
export type Process = (typeof PROCESSES)[number];

// No lead times here: we have no measured figure per process, so the UI shows
// none. A real lead time comes from the partner workshop when we quote.

// Materials. The first twelve are PROJECT_MATERIALS from lib/projects — the
// same keys and the same Projects.material_* translations, so a material
// chosen on the project workspace means the same thing here. fr4 is new: a PCB
// has to be made of something, and no other process can use it.
export const MATERIALS = [
  "pla",
  "petg",
  "abs",
  "resin",
  "aluminium_6061",
  "stainless_304",
  "mild_steel",
  "brass",
  "acrylic",
  "plywood",
  "mdf",
  "carbon_fibre",
  "fr4",
] as const;
export type Material = (typeof MATERIALS)[number];

// Which materials each process can actually work. Conservative: it lists what
// our network runs today, not everything the process can do in principle.
export const PROCESS_MATERIALS: Record<Process, readonly Material[]> = {
  "3d_printing": ["pla", "petg", "abs", "resin", "carbon_fibre"],
  cnc_machining: [
    "aluminium_6061",
    "stainless_304",
    "mild_steel",
    "brass",
    "acrylic",
    "plywood",
    "mdf",
  ],
  laser_cutting: [
    "stainless_304",
    "mild_steel",
    "aluminium_6061",
    "brass",
    "acrylic",
    "plywood",
    "mdf",
  ],
  pcb_manufacturing: ["fr4"],
  // Conductive metals only — EDM erodes with a spark, so plastics and wood
  // are not merely unsuitable, they are impossible.
  edm: ["stainless_304", "mild_steel", "aluminium_6061", "brass"],
};

export function isCompatible(material: string | null, process: string | null): boolean {
  if (!material || !process) return false;
  const allowed = PROCESS_MATERIALS[process as Process];
  return allowed ? (allowed as readonly string[]).includes(material) : false;
}

/** Processes that can work this material — used to offer a way out of a clash. */
export function processesFor(material: string): Process[] {
  return PROCESSES.filter((p) =>
    (PROCESS_MATERIALS[p] as readonly string[]).includes(material)
  );
}

// ── Disciplines ────────────────────────────────────────────────────────────
// The engineering disciplines a product can need. The workspace tree shows a
// branch per discipline the project actually needs (see ./tree).

export const DISCIPLINES = ["mechanical", "electronics", "software"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

// Schematic templates we can draw. 2D only — solid CAD stays a human service
// at /design/drawing, so nothing here pretends to produce STEP or STL.
export const SCHEMATIC_KINDS = ["outline", "flat_pattern", "bracket", "block_diagram"] as const;
export type SchematicKind = (typeof SCHEMATIC_KINDS)[number];

export const MAX_PARTS = 40;
export const MAX_BRIEF_CHARS = 8000;
/** Below this the brief can't describe a product, so it isn't analysed or counted. */
export const MIN_BRIEF_CHARS = 40;
