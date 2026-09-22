// Mechanical parts as dimension boxes. Deliberately simple: no CAD, no 3D.
//
// A part's shape and its millimetre dimensions (project_parts, migration 0023)
// give an outline — a rectangle for a block, a circle for a disc, a side view
// for a shaft, a flat outline for a laser-cut sheet — with dimension lines,
// values, units and a title block.
//
// A missing dimension is never guessed. The view that needs it is drawn as a
// labelled gap, and the page links it to the input that fills it. Views are
// drawn to a common scale from the real numbers, so proportions are true.
//
// Pure string building; same part, same SVG.

import { esc } from "./netlist";

export const SHAPES = ["block", "disc", "shaft", "sheet"] as const;
export type Shape = (typeof SHAPES)[number];

export const DIMS = ["length_mm", "width_mm", "height_mm", "diameter_mm", "thickness_mm"] as const;
export type Dim = (typeof DIMS)[number];

export type DimensionedPart = {
  id: string;
  code: string;
  name: string;
  material: string | null;
  process: string | null;
  quantity: number;
  shape?: string | null;
} & Partial<Record<Dim, number | string | null>>;

/** Laser-cut parts are always drawn flat, whatever shape was picked. */
export const effectiveShape = (p: DimensionedPart): Shape | null =>
  p.process === "laser_cutting" ? "sheet" : SHAPES.includes(p.shape as Shape) ? (p.shape as Shape) : null;

export const REQUIRED: Record<Shape, Dim[]> = {
  block: ["length_mm", "width_mm", "height_mm"],
  disc: ["diameter_mm", "thickness_mm"],
  shaft: ["diameter_mm", "length_mm"],
  sheet: ["length_mm", "width_mm", "thickness_mm"],
};

const val = (p: DimensionedPart, d: Dim): number | null => {
  const v = p[d];
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/** What the drawing still lacks: the shape, or named dimensions. */
export function missingDims(p: DimensionedPart): ("shape" | Dim)[] {
  const s = effectiveShape(p);
  if (!s) return ["shape"];
  return REQUIRED[s].filter((d) => val(p, d) === null);
}

export type DrawingLabels = {
  dim: Record<Dim, string>;
  missing: (what: string) => string;
  noShape: string;
  front: string;
  top: string;
  side: string;
  flat: string;
  thickness: (mm: string) => string;
  dxfNote: string;
  title: { part: string; material: string; process: string; quantity: string; scale: string; units: string };
  materialName: string;
  processName: string;
};

const INK = "#1c2434";
const MUTED = "#64748b";
const COBALT = "#0e59c5";
const GAP = "#b45309";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A dimension line with arrows between two points, value offset to one side. */
function dimLine(x1: number, y1: number, x2: number, y2: number, text: string, off: number): string {
  const horiz = y1 === y2;
  const [ax1, ay1, ax2, ay2] = horiz ? [x1, y1 + off, x2, y2 + off] : [x1 + off, y1, x2 + off, y2];
  const ext = horiz
    ? `<line x1="${x1}" y1="${y1}" x2="${x1}" y2="${ay1 + Math.sign(off) * 4}" /><line x1="${x2}" y1="${y2}" x2="${x2}" y2="${ay2 + Math.sign(off) * 4}" />`
    : `<line x1="${x1}" y1="${y1}" x2="${ax1 + Math.sign(off) * 4}" y2="${y1}" /><line x1="${x2}" y1="${y2}" x2="${ax2 + Math.sign(off) * 4}" y2="${y2}" />`;
  const mx = (ax1 + ax2) / 2;
  const my = (ay1 + ay2) / 2;
  const label = horiz
    ? `<text x="${mx}" y="${my + (off > 0 ? 14 : -5)}" text-anchor="middle" stroke="none" fill="${COBALT}" font-size="12" font-weight="600">${esc(text)}</text>`
    : `<text x="${mx + (off > 0 ? 6 : -6)}" y="${my + 4}" text-anchor="${off > 0 ? "start" : "end"}" stroke="none" fill="${COBALT}" font-size="12" font-weight="600">${esc(text)}</text>`;
  return `<g stroke="${COBALT}" stroke-width="1" fill="none">${ext}<line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" marker-start="url(#arr)" marker-end="url(#arr)"/>${label}</g>`;
}

/** A labelled gap in place of a view that cannot be drawn honestly. */
const gapBox = (x: number, y: number, w: number, h: number, text: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fffbeb" stroke="${GAP}" stroke-dasharray="6 4"/>
   <text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${GAP}">${esc(text)}</text>`;

const viewLabel = (x: number, y: number, t: string) =>
  `<text x="${x}" y="${y}" font-size="10" fill="${MUTED}" letter-spacing="0.08em">${esc(t.toUpperCase())}</text>`;

export function renderDimensionDrawing(p: DimensionedPart, L: DrawingLabels): string {
  const W = 640;
  const H = 420;
  const area = { x: 40, y: 40, w: 560, h: 250 };
  const s = effectiveShape(p);
  const parts: string[] = [];
  const missing = missingDims(p);
  const unit = "mm";
  const d = (k: Dim) => val(p, k);
  const miss = (k: Dim) => L.missing(L.dim[k]);

  if (!s) {
    parts.push(gapBox(area.x, area.y, area.w, area.h, L.noShape));
  } else if (s === "block" || s === "sheet") {
    const len = d("length_mm");
    const wid = d("width_mm");
    const second = s === "block" ? d("height_mm") : d("thickness_mm");
    // Plan view (length × width) on the left; front view (length × height or
    // thickness) on the right. One scale for both, from the real numbers.
    // A block shows two views side by side, so each gets half the width.
    const maxW = s === "block" ? 180 : 440;
    const k = len && wid ? Math.min(maxW / len, 180 / Math.max(wid, second ?? 0), 10) : 1;
    if (len && wid) {
      const w = len * k;
      const h = wid * k;
      const x = area.x + 30;
      const y = area.y + 24;
      parts.push(viewLabel(x, area.y + 10, s === "sheet" ? L.flat : L.top));
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f8fafc" stroke="${INK}" stroke-width="1.6"/>`);
      parts.push(dimLine(x, y + h, x + w, y + h, `${fmt(len)} ${unit}`, 26));
      parts.push(dimLine(x + w, y, x + w, y + h, `${fmt(wid)} ${unit}`, 22));
      if (s === "sheet") {
        // Thickness callout on the view's title line, clear of every dimension.
        const t = d("thickness_mm");
        parts.push(
          `<text x="${x + w}" y="${area.y + 10}" text-anchor="end" font-size="12" font-weight="600" fill="${t ? INK : GAP}">${esc(
            t ? L.thickness(`${fmt(t)} ${unit}`) : miss("thickness_mm")
          )}</text>`
        );
      } else if (second) {
        // Room on the right for the front view's own height dimension.
        const fx = area.x + area.w - 80 - w;
        parts.push(viewLabel(fx, area.y + 10, L.front));
        parts.push(`<rect x="${fx}" y="${y}" width="${w}" height="${second * k}" fill="#f8fafc" stroke="${INK}" stroke-width="1.6"/>`);
        parts.push(dimLine(fx + w, y, fx + w, y + second * k, `${fmt(second)} ${unit}`, 22));
      } else {
        parts.push(gapBox(area.x + area.w - 250, y, 220, 90, miss("height_mm")));
      }
    } else {
      parts.push(gapBox(area.x, area.y, area.w, area.h, missing.map((m) => (m === "shape" ? L.noShape : miss(m))).join(" · ")));
    }
  } else if (s === "disc") {
    const dia = d("diameter_mm");
    const t = d("thickness_mm");
    if (dia) {
      const k = Math.min(200 / dia, 10);
      const r = (dia * k) / 2;
      const cx = area.x + 40 + r;
      const cy = area.y + 30 + r;
      parts.push(viewLabel(area.x + 30, area.y + 10, L.front));
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f8fafc" stroke="${INK}" stroke-width="1.6"/>
        <line x1="${cx - r - 8}" y1="${cy}" x2="${cx + r + 8}" y2="${cy}" stroke="${MUTED}" stroke-dasharray="8 3 2 3"/>
        <line x1="${cx}" y1="${cy - r - 8}" x2="${cx}" y2="${cy + r + 8}" stroke="${MUTED}" stroke-dasharray="8 3 2 3"/>`);
      parts.push(dimLine(cx - r, cy + r, cx + r, cy + r, `Ø ${fmt(dia)} ${unit}`, 28));
      const sx = area.x + area.w - 140;
      if (t) {
        const tw = Math.max(t * k, 3);
        parts.push(viewLabel(sx, area.y + 10, L.side));
        parts.push(`<rect x="${sx}" y="${cy - r}" width="${tw}" height="${2 * r}" fill="#f8fafc" stroke="${INK}" stroke-width="1.6"/>`);
        parts.push(dimLine(sx, cy - r, sx + tw, cy - r, `${fmt(t)} ${unit}`, -18));
      } else parts.push(gapBox(sx - 40, cy - 45, 170, 90, miss("thickness_mm")));
    } else parts.push(gapBox(area.x, area.y, area.w, area.h, miss("diameter_mm")));
  } else {
    // Shaft: side view (length × diameter) and end view.
    const dia = d("diameter_mm");
    const len = d("length_mm");
    if (dia && len) {
      const k = Math.min(380 / len, 150 / dia, 10);
      const w = len * k;
      const h = dia * k;
      const x = area.x + 30;
      const y = area.y + 40;
      parts.push(viewLabel(x, area.y + 10, L.side));
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(3, h / 4)}" fill="#f8fafc" stroke="${INK}" stroke-width="1.6"/>
        <line x1="${x - 8}" y1="${y + h / 2}" x2="${x + w + 8}" y2="${y + h / 2}" stroke="${MUTED}" stroke-dasharray="8 3 2 3"/>`);
      parts.push(dimLine(x, y + h, x + w, y + h, `${fmt(len)} ${unit}`, 26));
      const ex = area.x + area.w - 30 - h / 2;
      parts.push(viewLabel(ex - h / 2, area.y + 10, L.front));
      parts.push(`<circle cx="${ex}" cy="${y + h / 2}" r="${h / 2}" fill="#f8fafc" stroke="${INK}" stroke-width="1.6"/>`);
      parts.push(dimLine(ex - h / 2, y + h, ex + h / 2, y + h, `Ø ${fmt(dia)} ${unit}`, 26));
    } else {
      parts.push(gapBox(area.x, area.y, area.w, area.h, missing.map((m) => (m === "shape" ? L.noShape : miss(m))).join(" · ")));
    }
  }

  // Title block.
  const ty = 318;
  const cells: [string, string][] = [
    [L.title.part, `${p.code} ${p.name}`],
    [L.title.material, L.materialName],
    [L.title.process, L.processName],
    [L.title.quantity, String(p.quantity)],
    [L.title.units, unit],
    [L.title.scale, missing.length ? "—" : "NTS"],
  ];
  const cw = (W - 40) / 3;
  const block = cells
    .map(([k, v], i) => {
      const cx = 20 + (i % 3) * cw;
      const cy = ty + Math.floor(i / 3) * 40;
      return `<rect x="${cx}" y="${cy}" width="${cw}" height="40" fill="none" stroke="${INK}" stroke-width="1"/>
        <text x="${cx + 8}" y="${cy + 14}" font-size="9" fill="${MUTED}" letter-spacing="0.06em">${esc(k.toUpperCase())}</text>
        <text x="${cx + 8}" y="${cy + 31}" font-size="12" font-weight="600" fill="${INK}">${esc(v.length > 34 ? `${v.slice(0, 33)}…` : v)}</text>`;
    })
    .join("");

  const note =
    s === "sheet"
      ? `<text x="20" y="${ty - 12}" font-size="11" font-weight="600" fill="${GAP}">${esc(L.dxfNote)}</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${COBALT}"/></marker></defs>
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="${INK}" stroke-width="1.2"/>
${parts.join("\n")}
${note}
${block}
</svg>`;
}
