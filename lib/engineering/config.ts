// Engineering jobs (owner, 2026-10-18) — the ONE config file. Pure.
//
// step_model = the Engineers level: our engineers deliver a full, editable STEP
// file of the whole project within ETA_HOURS. Never name the CAD program we use
// in any copy: "a full STEP file will be generated for you".
// Phase 4 adds the paid engineer services (assembly, cad_engineer, pcb_gerber).

import { BUCKETS } from "@/lib/storage/paths";

export type JobKind = "step_model" | "pcb_gerber" | "assembly" | "cad_engineer";
export type JobStatus = "queued" | "in_progress" | "ready" | "failed" | "cancelled";

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]?.trim());
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export const STEP_JOB = {
  kind: "step_model" as const,
  /** Ideation tokens (pass tokens first). ENGINEERS_JOB_TOKENS overrides on the server. */
  get tokens() {
    return envInt("ENGINEERS_JOB_TOKENS", 10);
  },
  /** What we promise: ready within 1–3 hours (working hours). */
  etaHours: { min: 1, max: 3 },
};

export const ENGINEERING_BUCKET = BUCKETS.engineeringFiles;
/** Result files and edited files sent back: up to 100 MB. */
export const ENGINEERING_MAX_BYTES = 100 * 1024 * 1024;
/** File types we take back for manufacturing. */
export const RETURN_EXTENSIONS = [".step", ".stp", ".zip"] as const;

export const isOpen = (s: JobStatus) => s === "queued" || s === "in_progress";
