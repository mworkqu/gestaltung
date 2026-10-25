// Storage bucket names, file-name sanitising and user-scoped object paths.
// Pure and browser-safe (no Supabase import), so client uploads and server
// routes use the same names.
//
// Every id below was checked against `insert into storage.buckets` in
// supabase/migrations and against the constants it replaces:
//   cad-files        lib/design/constants.ts CAD_BUCKET
//   quote-uploads    lib/design/constants.ts QUOTE_BUCKET
//   project-images   lib/projects/constants.ts PROJECT_IMAGE_BUCKET, lib/studio/server/product.ts PREVIEW_BUCKET
//   product-images   literals in lib/store/store-image.ts and api/admin/drive-import
//   videos           lib/videos.ts VIDEO_BUCKET
//   studio-models    literal STL_BUCKET in components/admin/studio-library/part-form.tsx
//   payment-proofs   lib/billing/server.ts PROOF_BUCKET (+ two page/client literals)
//   engineering-files lib/engineering/config.ts ENGINEERING_BUCKET

export const BUCKETS = {
  cadFiles: "cad-files",
  quoteUploads: "quote-uploads",
  projectImages: "project-images",
  productImages: "product-images",
  videos: "videos",
  studioModels: "studio-models",
  paymentProofs: "payment-proofs",
  engineeringFiles: "engineering-files",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/**
 * A file name that is safe inside a storage object path.
 *
 * Six sanitizers existed (CODE_QUALITY_AUDIT D-24). This is the strictest
 * behaviour that still keeps the extension:
 *   - every character outside A-Z a-z 0-9 . _ - becomes "_" (runs collapse to one),
 *     so no path separators, spaces, percent signs or non-ASCII survive;
 *   - runs of dots collapse to one and leading dots are dropped (no "..", no hidden files);
 *   - capped at `max` characters (default 80, the limit the store-lead PRINT_PATH
 *     regex allows) by shortening the stem, never the extension;
 *   - an empty result becomes `fallback` (default "file").
 * Differences from the old copies: quote-request.tsx kept leading dots and had no
 * cap; upload-result.tsx and step-panel.tsx cut the end/start of the name (losing
 * or keeping the extension by luck); api.ts truncated from the end.
 */
export function safeFileName(name: string, opts: { max?: number; fallback?: string } = {}): string {
  const max = opts.max ?? 80;
  const fallback = opts.fallback ?? "file";
  let s = String(name)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.]+/, "");
  if (s.length > max) {
    const dot = s.lastIndexOf(".");
    // Keep a short real extension; otherwise (no dot, or an absurdly long "extension") just cut.
    const ext = dot > 0 && s.length - dot <= 16 ? s.slice(dot) : "";
    s = s.slice(0, max - ext.length) + ext;
  }
  return s || fallback;
}

/**
 * `<userId>/<seg>/<seg>/…` for an object key. Storage RLS policies match the first
 * folder against auth.uid(), so the user id always leads. A segment may itself
 * hold slashes (`"print/2026-10-22"`); each piece is checked. Throws on an empty
 * piece, ".", "..", "%" (encoded traversal) or a backslash, in the user id too.
 */
export function userPath(userId: string, ...segments: string[]): string {
  const parts: string[] = [];
  for (const raw of [userId, ...segments]) {
    if (typeof raw !== "string" || raw === "") throw new Error("userPath: empty segment");
    if (raw.includes("\\") || raw.includes("%")) throw new Error("userPath: illegal character in segment");
    for (const piece of raw.split("/")) {
      if (piece === "" || piece === "." || piece === "..") throw new Error("userPath: illegal segment");
      parts.push(piece);
    }
  }
  if (userId.includes("/")) throw new Error("userPath: userId must be a single segment");
  return parts.join("/");
}
