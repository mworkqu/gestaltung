// Storage bucket for public "request a quote" file uploads (see migration
// 0012_quote_uploads.sql). Private bucket; the browser uploads directly with the
// anon key, the server mints signed download URLs with the service-role key.
export const QUOTE_BUCKET = "quote-uploads";

// Storage bucket for CAD files attached to a project (see migration
// 0005_jobs.sql, which created it). The jobs pipeline that originally wrote to
// it is gone; the bucket and its contents are kept, and its policies are
// rescoped from tenant paths to <user_id>/… when project attachments land.
export const CAD_BUCKET = "cad-files";

// ── Accepted CAD formats ──────────────────────────────────────────────────
// Shared by every CAD entry point: the homepage dropzone, the public quote
// request form, and (later) project file attachments.

export const FILE_EXTS = ["stl", "step", "dxf", "iges"] as const;
export type NormalizedExt = (typeof FILE_EXTS)[number];

// Raw upload extension -> normalized extension stored alongside the file.
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
