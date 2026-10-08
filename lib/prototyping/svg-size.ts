// Sizing for a generated SVG inside its frame (audit #38). Pure.

/** width / height from the root `viewBox` (else width/height attributes); null when neither is readable. */
export function svgAspect(svg: string): number | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const vb = /\bviewBox\s*=\s*"([^"]+)"/i.exec(root)?.[1];
  if (vb) {
    const n = vb.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n[2] > 0 && n[3] > 0 && n.every(Number.isFinite)) return n[2] / n[3];
  }
  const w = Number(/\swidth\s*=\s*"([\d.]+)"/i.exec(root)?.[1]);
  const h = Number(/\sheight\s*=\s*"([\d.]+)"/i.exec(root)?.[1]);
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * The narrowest the drawing may render so it is never shorter than
 * `minHeightPx` (a wide diagram in a narrow column scrolls sideways at a
 * readable size instead of shrinking to tiny labels).
 */
export function minFrameWidthPx(aspect: number | null, minHeightPx: number): number {
  if (!aspect || !(minHeightPx > 0)) return 0;
  return Math.round(aspect * minHeightPx);
}
