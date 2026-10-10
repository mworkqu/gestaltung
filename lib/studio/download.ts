// Browser downloads without three.js (safe in the first-load bundle). The STL
// writers live in export.ts, which the steps load on demand.

/** Save data as a file in the browser (no-op outside a browser). */
export function downloadBlob(name: string, data: BlobPart, mime = "application/octet-stream"): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** An SVG string as a Blob (schematic / wiring downloads). */
export function exportSVG(svgString: string): Blob {
  const text = svgString.trimStart().startsWith("<?xml") ? svgString : `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
  return new Blob([text], { type: "image/svg+xml" });
}
