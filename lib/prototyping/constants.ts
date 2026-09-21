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

// Working days for a small batch, used for the critical-path line in the
// manufacturing recommendation. Rough by design; a real figure comes from the
// partner workshop when we quote.
export const PROCESS_LEAD_DAYS: Record<Process, number> = {
  "3d_printing": 2,
  cnc_machining: 5,
  laser_cutting: 3,
  pcb_manufacturing: 10,
  edm: 6,
};

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

// ── Stages ─────────────────────────────────────────────────────────────────
// The fixed spine of the prototyping flow. Quote is deliberately near the end
// and deliberately small: this is a product-development workspace, not a
// checkout.

export const STAGES = [
  "idea",
  "concepts",
  "parts",
  "design",
  "engineering",
  "manufacturing",
  "quote",
  "production",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_STATUSES = ["locked", "needs", "progress", "complete"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** The state a project starts in: describe the idea, everything else waits. */
export const DEFAULT_STAGES: Record<Stage, StageStatus> = {
  idea: "progress",
  concepts: "locked",
  parts: "locked",
  design: "locked",
  engineering: "locked",
  manufacturing: "locked",
  quote: "locked",
  production: "locked",
};

export function stageMap(raw: unknown): Record<Stage, StageStatus> {
  const stored = (raw ?? {}) as Record<string, string>;
  const out = { ...DEFAULT_STAGES };
  for (const s of STAGES) {
    const v = stored[s];
    if ((STAGE_STATUSES as readonly string[]).includes(v)) out[s] = v as StageStatus;
  }
  return out;
}

export const nextStage = (s: Stage): Stage | null =>
  STAGES[STAGES.indexOf(s) + 1] ?? null;

// Schematic templates we can draw. 2D only — solid CAD stays a human service
// at /design/drawing, so nothing here pretends to produce STEP or STL.
export const SCHEMATIC_KINDS = ["outline", "flat_pattern", "bracket", "block_diagram"] as const;
export type SchematicKind = (typeof SCHEMATIC_KINDS)[number];

export const MAX_PARTS = 40;
export const MAX_BRIEF_CHARS = 8000;
