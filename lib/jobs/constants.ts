// Shared between the client upload form and the server action.

export const CAD_BUCKET = "cad-files";

export const JOB_METHODS = [
  "3d_printing",
  "cnc_machining",
  "laser_cutting",
  "edm",
] as const;

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
