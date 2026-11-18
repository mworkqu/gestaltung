// Skill-map radar geometry (pure). Used by the results page (React SVG), the
// share page and the report HTML (radarSvgMarkup), so all three draw the
// same chart. Six axes, area 1 at the top, clockwise. The SVG is always laid
// out left-to-right (dir="ltr"); text anchors come from the geometry, so the
// labels sit correctly in an Arabic page too (Arabic runs still shape RTL).

export interface RadarAxisInput {
  id: number;
  label: string;
  /** 0-100, or null when not assessed. */
  percent: number | null;
}

export interface RadarAxis {
  id: number;
  label: string;
  lines: string[];
  assessed: boolean;
  percent: number | null;
  /** Axis end on the outer ring. */
  x: number;
  y: number;
  /** Label anchor point. */
  lx: number;
  ly: number;
  anchor: "start" | "middle" | "end";
  /** Value point (centre when not assessed). */
  vx: number;
  vy: number;
}

export interface RadarGeometry {
  size: number;
  /** viewBox width (wider than tall, room for side labels). */
  width: number;
  cx: number;
  cy: number;
  r: number;
  rings: string[];
  axes: RadarAxis[];
  /** Polygon over the assessed axes only (null with fewer than 1 assessed). */
  valuePolygon: string | null;
}

const RING_STEPS = [0.25, 0.5, 0.75, 1];

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Splits a label into at most 2 lines of ~maxChars. */
export function wrapLabel(label: string, maxChars = 16): string[] {
  const words = label.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(" ")];
}

export function radarGeometry(inputs: readonly RadarAxisInput[], size = 360): RadarGeometry {
  const width = Math.round(size * 1.4);
  const cx = width / 2;
  const cy = size / 2;
  const r = size * 0.3;
  const n = Math.max(3, inputs.length);
  const point = (i: number, k: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k, cos: Math.cos(a), sin: Math.sin(a) };
  };
  const rings = RING_STEPS.map((k) =>
    Array.from({ length: n }, (_, i) => {
      const p = point(i, k);
      return `${fmt(p.x)},${fmt(p.y)}`;
    }).join(" ")
  );
  const axes: RadarAxis[] = inputs.map((inp, i) => {
    const end = point(i, 1);
    const lab = point(i, 1.16);
    const assessed = inp.percent != null && Number.isFinite(inp.percent);
    const k = assessed ? Math.min(100, Math.max(0, inp.percent as number)) / 100 : 0;
    const v = point(i, k);
    const anchor: RadarAxis["anchor"] = Math.abs(end.cos) < 0.2 ? "middle" : end.cos > 0 ? "start" : "end";
    return {
      id: inp.id,
      label: inp.label,
      lines: wrapLabel(inp.label),
      assessed,
      percent: assessed ? (inp.percent as number) : null,
      x: end.x,
      y: end.y,
      lx: lab.x,
      ly: lab.y + (end.sin > 0.5 ? 8 : end.sin < -0.5 ? -6 : 0),
      anchor,
      vx: v.x,
      vy: v.y,
    };
  });
  const assessedAxes = axes.filter((a) => a.assessed);
  const valuePolygon = assessedAxes.length ? axes.map((a) => `${fmt(a.vx)},${fmt(a.vy)}`).join(" ") : null;
  return { size, width, cx, cy, r, rings, axes, valuePolygon };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Text anchor for a label in the page direction. The chart is laid out LTR,
 * but Arabic labels need direction="rtl" to order mixed runs ("النمذجة 3D")
 * correctly, and in RTL text "start" means the right edge, so swap.
 */
export function labelAnchor(anchor: RadarAxis["anchor"], rtl: boolean): RadarAxis["anchor"] {
  if (!rtl || anchor === "middle") return anchor;
  return anchor === "start" ? "end" : "start";
}

/** Static SVG markup (report / print). Colours are inline (no CSS variables). */
export function radarSvgMarkup(
  inputs: readonly RadarAxisInput[],
  opts: { title: string; notAssessed: string; size?: number; font?: string; rtl?: boolean }
): string {
  const rtl = !!opts.rtl;
  const g = radarGeometry(inputs, opts.size ?? 360);
  const font = opts.font ?? "'IBM Plex Sans Arabic', Arial, sans-serif";
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${g.size}" width="${g.width}" height="${g.size}" role="img" aria-label="${esc(opts.title)}" direction="ltr" style="direction:ltr;font-family:${font}">`
  );
  for (const ring of g.rings) parts.push(`<polygon points="${ring}" fill="none" stroke="#d3dbe6" stroke-width="1"/>`);
  for (const a of g.axes) {
    parts.push(
      `<line x1="${fmt(g.cx)}" y1="${fmt(g.cy)}" x2="${fmt(a.x)}" y2="${fmt(a.y)}" stroke="${a.assessed ? "#94a3b8" : "#cbd5e1"}" stroke-width="1"${a.assessed ? "" : ' stroke-dasharray="4 4"'}/>`
    );
  }
  if (g.valuePolygon) parts.push(`<polygon points="${g.valuePolygon}" fill="rgba(14,89,197,0.22)" stroke="#0e59c5" stroke-width="2" stroke-linejoin="round"/>`);
  for (const a of g.axes) {
    if (a.assessed) parts.push(`<circle cx="${fmt(a.vx)}" cy="${fmt(a.vy)}" r="3.5" fill="#0e59c5"/>`);
    const color = a.assessed ? "#1c2434" : "#94a3b8";
    const sub = a.assessed ? `${Math.round(a.percent as number)}%` : opts.notAssessed;
    const lines = [...a.lines, sub];
    const startY = a.ly - ((lines.length - 1) * 13) / 2;
    parts.push(
      `<text x="${fmt(a.lx)}" y="${fmt(startY)}" text-anchor="${labelAnchor(a.anchor, rtl)}" direction="${rtl ? "rtl" : "ltr"}" font-size="11" fill="${color}">${lines
        .map((l, i) => `<tspan x="${fmt(a.lx)}" dy="${i === 0 ? 0 : 13}"${i === lines.length - 1 ? ' font-weight="700"' : ""}>${esc(l)}</tspan>`)
        .join("")}</text>`
    );
  }
  parts.push(`</svg>`);
  return parts.join("");
}
