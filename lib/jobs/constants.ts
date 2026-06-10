// Shared between the client upload form and the server action.

export const CAD_BUCKET = "cad-files";

export const JOB_METHODS = [
  "3d_printing",
  "cnc_machining",
  "laser_cutting",
  "edm",
] as const;

// Canonical status set + the linear workshop progression chain.
export const JOB_STATUSES = [
  "submitted",
  "quoted",
  "in_production",
  "ready",
  "delivered",
  "cancelled",
] as const;

export const STATUS_CHAIN = [
  "submitted",
  "quoted",
  "in_production",
  "ready",
  "delivered",
] as const;

// The next status a workshop can advance to, or null at the end of the chain.
export function nextStatus(current: string): string | null {
  const i = (STATUS_CHAIN as readonly string[]).indexOf(current);
  return i >= 0 && i < STATUS_CHAIN.length - 1 ? STATUS_CHAIN[i + 1] : null;
}

// A job is locked from variations once it's delivered or cancelled.
export const VARY_LOCKED_STATUSES = ["delivered", "cancelled"] as const;

// Whether a caller may edit ("vary") a job. Shared by the detail page, the edit
// page, and the server actions so the rule lives in one place:
//   client      -> own job, only while still 'submitted' (pre-approval)
//   workshop    -> its assigned job (incl. its own internal jobs), any non-terminal status
//   super_admin -> any non-terminal job
export function canVaryJob(opts: {
  role: string;
  tenantId: string | null;
  job: {
    status: string;
    client_tenant_id: string;
    assigned_workshop_tenant_id: string | null;
    job_source?: string;
  };
}): boolean {
  const { role, tenantId, job } = opts;
  if ((VARY_LOCKED_STATUSES as readonly string[]).includes(job.status)) return false;
  if (role === "super_admin") return true;
  if (
    role === "client" &&
    job.client_tenant_id === tenantId &&
    job.status === "submitted"
  ) {
    return true;
  }
  if (role === "workshop" && job.assigned_workshop_tenant_id === tenantId) {
    return true;
  }
  return false;
}

// ---- Stage 8b: upload-funnel upsells ---------------------------------------

export const JOB_PATHS = ["prototype", "production"] as const;
export const SPEED_TIERS = ["standard", "express"] as const;
export const PRODUCTION_QTY_RANGES = [
  "10-50",
  "50-250",
  "250-1000",
  "1000+",
] as const;
// Post-processing options stored in jobs.post_processing. The inspection
// report is a separate boolean column, not a member of this array.
export const POST_PROCESSING_OPTIONS = ["bead_blast", "anodize"] as const;

export const FILE_EXTS = ["stl", "step", "dxf", "iges"] as const;
export type NormalizedExt = (typeof FILE_EXTS)[number];

// Raw upload extension -> normalized file_ext stored in the DB.
export const EXT_ALIASES: Record<string, NormalizedExt> = {
  stl: "stl",
  step: "step",
  stp: "step",
  dxf: "dxf",
  iges: "iges",
  igs: "iges",
};

// Accepted upload extensions (for the file input + validation).
export const ACCEPT_EXTENSIONS = Object.keys(EXT_ALIASES);
export const ACCEPT_ATTR = ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(",");

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
