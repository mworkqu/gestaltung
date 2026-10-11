// Pure maths for the wiring-diagram viewer (fit, clamp, zoom at a point, pinch).
// A view transform maps content units to container pixels:
//   screen = content * scale + (x, y)
// No DOM here, so every rule is unit-tested (viewport.test.ts).

export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export type ViewTransform = { scale: number; x: number; y: number };

/** The smallest text we draw is 10 SVG units (schematic.ts); it must never render under this many px. */
export const MIN_TEXT_PX = 9;
export const SMALLEST_FONT_UNITS = 10;
export const MAX_SCALE = 4;
/** Padding kept around the drawing when it is fitted, in px. */
export const FIT_PADDING = 16;
export const ZOOM_STEP = 1.25;

/** Smallest zoom at which the smallest text is still MIN_TEXT_PX tall. */
export function textFloorScale(minTextPx = MIN_TEXT_PX, smallestFontUnits = SMALLEST_FONT_UNITS): number {
  return minTextPx / smallestFontUnits;
}

export type Fit = ViewTransform & {
  /** "both" = whole drawing visible; "width" = fitted to the width, pan vertically (height would be unreadable). */
  mode: "both" | "width";
};

/**
 * Fit the whole content in the view with padding, centred. When that would shrink text under the
 * floor, fit the width only (top aligned) so the drawing can be panned vertically instead.
 */
export function fitTransform(view: Size, content: Size, padding = FIT_PADDING, floor = textFloorScale()): Fit {
  const aw = Math.max(1, view.w - 2 * padding);
  const ah = Math.max(1, view.h - 2 * padding);
  const sBoth = Math.min(aw / content.w, ah / content.h, MAX_SCALE);
  if (sBoth >= floor) {
    return {
      scale: sBoth,
      x: (view.w - content.w * sBoth) / 2,
      y: (view.h - content.h * sBoth) / 2,
      mode: "both",
    };
  }
  const sWidth = Math.min(aw / content.w, MAX_SCALE);
  return {
    scale: sWidth,
    x: (view.w - content.w * sWidth) / 2,
    y: padding,
    mode: "width",
  };
}

/** Lowest zoom the user may reach: the text floor, but never above what Fit itself needs. */
export function minScaleFor(fit: Fit, floor = textFloorScale()): number {
  return Math.min(floor, fit.scale);
}

export function clampScale(scale: number, min: number, max = MAX_SCALE): number {
  if (!Number.isFinite(scale)) return min;
  return Math.min(max, Math.max(min, scale));
}

/** Keep the drawing reachable: smaller than the view -> inside it; larger -> edges may not leave the padding. */
export function clampPan(t: ViewTransform, view: Size, content: Size, padding = FIT_PADDING): ViewTransform {
  const range = (pos: number, viewLen: number, contentLen: number) => {
    const scaled = contentLen * t.scale;
    if (scaled <= viewLen - 2 * padding) {
      const lo = padding;
      const hi = viewLen - padding - scaled;
      return Math.min(hi, Math.max(lo, pos));
    }
    const lo = viewLen - padding - scaled;
    const hi = padding;
    return Math.min(hi, Math.max(lo, pos));
  };
  return { scale: t.scale, x: range(t.x, view.w, content.w), y: range(t.y, view.h, content.h) };
}

/** Zoom to `nextScale`, keeping the content point under `anchor` (view px) where it is. */
export function zoomAt(t: ViewTransform, nextScale: number, anchor: Point, min: number, max = MAX_SCALE): ViewTransform {
  const s = clampScale(nextScale, min, max);
  const ratio = s / t.scale;
  return { scale: s, x: anchor.x - (anchor.x - t.x) * ratio, y: anchor.y - (anchor.y - t.y) * ratio };
}

/** Zoom by a factor (buttons: ZOOM_STEP; wheel: exp(-delta * k)) around `anchor`. */
export function zoomBy(t: ViewTransform, factor: number, anchor: Point, min: number, max = MAX_SCALE): ViewTransform {
  return zoomAt(t, t.scale * factor, anchor, min, max);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Two-finger gesture: scale by the change in finger distance, anchored on the content point that was
 * under the start midpoint, which then follows the current midpoint (so a pinch also pans).
 */
export function pinchTransform(
  start: { t: ViewTransform; mid: Point; dist: number },
  now: { mid: Point; dist: number },
  min: number,
  max = MAX_SCALE,
): ViewTransform {
  const s = clampScale(start.t.scale * (start.dist > 0 ? now.dist / start.dist : 1), min, max);
  const cx = (start.mid.x - start.t.x) / start.t.scale;
  const cy = (start.mid.y - start.t.y) / start.t.scale;
  return { scale: s, x: now.mid.x - cx * s, y: now.mid.y - cy * s };
}

/** Zoom label: natural size (1 drawing unit = 1 px) is 100 %. */
export function percentLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Read the drawing size from the generated SVG's viewBox ("minX minY w h"). */
export function parseViewBox(svg: string): Size | null {
  const m = /viewBox="\s*-?[\d.]+[ ,]+-?[\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/.exec(svg);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}
