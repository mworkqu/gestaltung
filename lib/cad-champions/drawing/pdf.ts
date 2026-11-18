// Light PDF checks for the AI drawing check. PURE; tested in pdf.test.ts.
// No PDF library: a page count from the raw bytes is enough to enforce the
// limits. PDFs that hide their page objects in compressed object streams give
// `null` (unknown); the caller then lets the request through and the API's own
// limits apply.

export const AI_MAX_PAGES = 5;
export const AI_MAX_BYTES = 20 * 1024 * 1024;

export function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-" within the first 1 KB (some writers put junk before it).
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 1024)));
  return head.includes("%PDF-");
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/**
 * Number of pages, or null when it cannot be read from the uncompressed text.
 * Counts "/Type /Page" objects (not "/Pages"); falls back to the largest
 * "/Count n" of a "/Type /Pages" node.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  if (!isPdf(bytes)) return null;
  const text = latin1(bytes);
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (pages > 0) return pages;
  let best = 0;
  const re = /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best > 0 ? best : null;
}

export type PdfLimitProblem = "not_pdf" | "too_large" | "too_many_pages";

/** Why the AI must skip this file, or null when it is fine. */
export function pdfLimitProblem(bytes: Uint8Array): PdfLimitProblem | null {
  if (bytes.length > AI_MAX_BYTES) return "too_large";
  if (!isPdf(bytes)) return "not_pdf";
  const pages = countPdfPages(bytes);
  if (pages != null && pages > AI_MAX_PAGES) return "too_many_pages";
  return null;
}
