// Upload validation shared by the browser (UploadBox) and the server
// (verifyUploadedObject). Pure: no DOM, no I/O. Tested in validate.test.ts.

export type UploadAccept = "step" | "pdf" | "image" | "video" | "zip";

export const UPLOAD_ACCEPTS: readonly UploadAccept[] = ["step", "pdf", "image", "video", "zip"];

/** 50 MB, the cc-submissions bucket limit. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Files above this go through TUS resumable upload (Supabase standard upload limit for a single request). */
export const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;

/** Supabase requires exactly 6 MB chunks for resumable uploads. */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

/** A STEP file (ISO 10303-21) must start with this text. */
export const STEP_MAGIC = "ISO-10303-21";

/** Bytes read from the start of a file to check its header. */
export const HEADER_BYTES = 64;

export const ACCEPT_EXTENSIONS: Record<UploadAccept, readonly string[]> = {
  step: [".step", ".stp"],
  pdf: [".pdf"],
  image: [".png", ".jpg", ".jpeg", ".webp"],
  video: [".mp4", ".webm"],
  zip: [".zip"],
};

const EXT_MIME: Record<string, string> = {
  ".step": "application/step",
  ".stp": "application/step",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
};

export type UploadErrorCode = "wrong_extension" | "too_large" | "empty" | "not_step" | "interrupted" | "failed" | "signed_out";

export type UploadValidation =
  | { ok: true }
  | { ok: false; code: UploadErrorCode; extension?: string; sizeBytes?: number; maxBytes?: number };

/** Lower-case extension with the dot (".step"), or "" when there is none. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot).toLowerCase();
}

/** Value for <input type="file" accept>. */
export function acceptAttribute(accept: UploadAccept): string {
  return ACCEPT_EXTENSIONS[accept].join(",");
}

/** Content type sent to Storage (browsers give STEP files no type; the bucket refuses text/plain). */
export function contentTypeFor(fileName: string, accept: UploadAccept): string {
  return EXT_MIME[fileExtension(fileName)] ?? (accept === "step" ? "application/step" : "application/octet-stream");
}

/** Checks name and size (no file content). */
export function validateFileMeta(
  file: { name: string; size: number },
  accept: UploadAccept,
  maxBytes: number = DEFAULT_MAX_BYTES
): UploadValidation {
  const extension = fileExtension(file.name);
  if (!ACCEPT_EXTENSIONS[accept].includes(extension)) return { ok: false, code: "wrong_extension", extension };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, code: "empty" };
  if (file.size > maxBytes) return { ok: false, code: "too_large", sizeBytes: file.size, maxBytes };
  return { ok: true };
}

/**
 * True when the bytes start with "ISO-10303-21" (a STEP Part 21 file).
 * A UTF-8 byte-order mark and leading whitespace are allowed.
 */
export function isStepHeader(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes.length - i < STEP_MAGIC.length) return false;
  for (let k = 0; k < STEP_MAGIC.length; k++) {
    if (bytes[i + k] !== STEP_MAGIC.charCodeAt(k)) return false;
  }
  return true;
}

/** Checks the first bytes of a file for its type (only STEP has a header rule). */
export function validateHeader(bytes: Uint8Array, accept: UploadAccept): UploadValidation {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  if (accept === "step" && !isStepHeader(bytes)) return { ok: false, code: "not_step" };
  return { ok: true };
}

/** Storage-safe file name: ASCII letters, digits, dot, dash, underscore; keeps the extension; max 100 chars. */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").normalize("NFKD");
  const ext = fileExtension(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const cleanStem =
    stem
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 100 - ext.length) || "file";
  return `${cleanStem}${ext}`;
}

/** `${prefix}${timestamp}_${safeName}`; the prefix must end with "/". */
export function buildObjectPath(prefix: string, fileName: string, now: number = Date.now()): string {
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${p}${now}_${safeFileName(fileName)}`;
}

/** True when `path` is a plain object path under `prefix` (no "..", no leading slash, no backslash). */
export function isPathUnderPrefix(path: unknown, prefix: string): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("//")) return false;
  if (path.split("/").some((seg) => seg === ".." || seg === ".")) return false;
  return path.startsWith(prefix) && path.length > prefix.length;
}

export type UploadMethod = "standard" | "resumable";

/** Standard upload up to 6 MB, TUS resumable above. */
export function chooseUploadMethod(sizeBytes: number): UploadMethod {
  return sizeBytes > TUS_THRESHOLD_BYTES ? "resumable" : "standard";
}
