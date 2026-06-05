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
