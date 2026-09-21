// 2D schematic generation.
//
// Deliberately NOT CAD. These are drawn from templates plus whatever the
// client asked for in a refine prompt, and they exist to have something
// concrete to talk about and mark up — dimensions, openings, hole patterns,
// a block diagram. Solid geometry (STEP/STL) stays a human service at
// /design/drawing, so nothing here claims to be manufacturable output.
//
// Pure string building: the same inputs always draw the same SVG, which is
// what makes a revision reproducible and diffable.

import type { SchematicKind } from "./constants";

const INK = "#1c2434";
const COBALT = "#0e59c5";
const FAINT = "#94a3b8";

/** Drawing options a refine prompt can turn on. */
export type SchematicFeatures = {
  dimensions: boolean;
  vents: boolean;
  holes: boolean;
  section: boolean;
  /** Free text echoed into the title block so the drawing records the ask. */
  noteKeys: string[];
};

export const BASE_FEATURES: SchematicFeatures = {
  dimensions: true,
  vents: false,
  holes: false,
  section: false,
  noteKeys: [],
};

/**
 * Reads a refine instruction. Recognised asks change the drawing; anything
 * else is still recorded on the revision, so the client can see we kept the
 * request even when we could not draw it.
 */
export function applyPrompt(base: SchematicFeatures, prompt: string): SchematicFeatures {
  const p = prompt.toLowerCase();
  const next: SchematicFeatures = { ...base, noteKeys: [...base.noteKeys] };
  let understood = false;

  // Plural and inflected forms matter here: people write "ventilation slots",
  // "bolt holes", "dimensions" — a bare \bvent\b would miss every one of them.
  if (/\b(vent\w*|slot\w*|louvre\w*|louver\w*|airflow|cool\w*)\b/.test(p)) { next.vents = true; understood = true; }
  if (/\b(hole\w*|bolt\w*|screw\w*|fixing\w*|drill\w*|thread\w*|fastener\w*)\b/.test(p)) { next.holes = true; understood = true; }
  if (/\b(section\w*|cut-?away|cross-?section|internal\w*)\b/.test(p)) { next.section = true; understood = true; }
  if (/\b(dimension\w*|dim|measure\w*|size\w*|mm)\b/.test(p)) { next.dimensions = true; understood = true; }
  if (/\b(no|remove|without)\s+dimension\w*/.test(p)) { next.dimensions = false; understood = true; }

  if (!understood) next.noteKeys.push("unrecognised");
  return next;
}

export type DrawInput = {
  code: string;
  rev: number;
  kind: SchematicKind;
  /** Shown in the drawing title block. Already translated by the caller. */
  title: string;
  material: string;
  quantity: number;
  features: SchematicFeatures;
};

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const dimH = (x1: number, x2: number, y: number, label: string) =>
  `<g stroke="${COBALT}" stroke-width="1"><path d="M${x1} ${y}H${x2}M${x1} ${y - 5}v10M${x2} ${y - 5}v10"/></g>` +
  `<text x="${(x1 + x2) / 2}" y="${y - 6}" fill="${COBALT}" font-size="10" text-anchor="middle" font-family="monospace">${label}</text>`;

const dimV = (x: number, y1: number, y2: number, label: string) =>
  `<g stroke="${COBALT}" stroke-width="1"><path d="M${x} ${y1}V${y2}M${x - 5} ${y1}h10M${x - 5} ${y2}h10"/></g>` +
  `<text x="${x - 7}" y="${(y1 + y2) / 2}" fill="${COBALT}" font-size="10" text-anchor="middle" font-family="monospace" transform="rotate(-90 ${x - 7} ${(y1 + y2) / 2})">${label}</text>`;

function titleBlock(i: DrawInput) {
  return (
    `<g font-family="monospace" fill="${INK}">` +
    `<rect x="372" y="232" width="136" height="76" fill="#ffffff" fill-opacity="0.65" stroke="${INK}" stroke-width="1"/>` +
    `<path d="M372 250h136M372 268h136M372 288h136M440 288v20" stroke="${INK}" stroke-width="0.6"/>` +
    `<text x="379" y="245" font-size="9" font-weight="500">GESTALTUNG</text>` +
    `<text x="379" y="263" font-size="9">${esc(i.code)}</text>` +
    `<text x="379" y="282" font-size="8.5">${esc(i.material.slice(0, 18).toUpperCase())}</text>` +
    `<text x="379" y="302" font-size="9" fill="${COBALT}">REV ${i.rev}</text>` +
    `<text x="447" y="302" font-size="9">×${i.quantity}</text>` +
    `</g>`
  );
}

function outline(i: DrawInput) {
  const f = i.features;
  let s = `<g stroke="${INK}" stroke-width="1.6" fill="rgba(255,255,255,0.35)" stroke-linejoin="round">`;
  s += `<rect x="70" y="64" width="150" height="196" rx="6"/>`;
  s += `<rect x="286" y="64" width="86" height="196" rx="6"/>`;
  s += `</g>`;
  s += `<path d="M145 44V282M329 44V282" stroke="${FAINT}" stroke-dasharray="8 4 2 4" stroke-width="0.8"/>`;
  if (f.section)
    s += `<g stroke="${INK}" stroke-width="1.2" stroke-dasharray="5 3" fill="none"><path d="M96 92h98v60l-24 66h-50l-24-66z"/><path d="M300 92h58v56l-16 70h-26l-16-70z"/></g>`;
  if (f.holes)
    s += `<g stroke="${INK}" stroke-width="1.2" fill="none">${[0, 1, 2, 3]
      .map((n) => `<circle cx="${92 + (n % 2) * 106}" cy="${88 + Math.floor(n / 2) * 148}" r="6"/>`)
      .join("")}</g>`;
  if (f.vents)
    s += `<g stroke="${INK}" stroke-width="1.1" fill="none">${[0, 1, 2, 3, 4]
      .map((n) => `<rect x="300" y="${150 + n * 14}" width="58" height="6" rx="3"/>`)
      .join("")}</g>` +
      `<text x="300" y="142" font-family="monospace" font-size="8" fill="${FAINT}">VENTS ×5</text>`;
  if (f.dimensions) s += dimH(70, 220, 292, "150") + dimV(52, 64, 260, "196") + dimH(286, 372, 292, "86");
  s += `<g font-family="monospace" font-size="9" fill="${FAINT}"><text x="128" y="312">FRONT</text><text x="312" y="312">SIDE</text></g>`;
  return s;
}

function flatPattern(i: DrawInput) {
  const f = i.features;
  // Developed blank with bend lines — what a laser cutter and press brake see.
  let s = `<path d="M60 92h300v144H60z" fill="rgba(255,255,255,0.35)" stroke="${INK}" stroke-width="1.6"/>`;
  s += `<g stroke="${COBALT}" stroke-width="1" stroke-dasharray="7 4"><path d="M120 92v144M300 92v144"/></g>`;
  s += `<text x="124" y="86" font-family="monospace" font-size="8" fill="${COBALT}">BEND 90°</text>`;
  s += `<text x="304" y="86" font-family="monospace" font-size="8" fill="${COBALT}">BEND 90°</text>`;
  if (f.holes)
    s += `<g stroke="${INK}" stroke-width="1.2" fill="none">${[0, 1, 2, 3, 4, 5]
      .map((n) => `<circle cx="${90 + (n % 3) * 105}" cy="${116 + Math.floor(n / 3) * 96}" r="5.5"/>`)
      .join("")}</g>`;
  if (f.vents)
    s += `<g stroke="${INK}" stroke-width="1.1" fill="none">${[0, 1, 2, 3]
      .map((n) => `<rect x="150" y="${130 + n * 18}" width="120" height="7" rx="3.5"/>`)
      .join("")}</g>`;
  s += `<rect x="176" y="168" width="68" height="44" rx="6" stroke="${INK}" stroke-width="1.3" fill="none"/>`;
  s += `<text x="178" y="164" font-family="monospace" font-size="8" fill="${FAINT}">OPENING</text>`;
  if (f.dimensions) s += dimH(60, 360, 262, "300") + dimV(44, 92, 236, "144");
  s += `<text x="60" y="312" font-family="monospace" font-size="9" fill="${FAINT}">FLAT PATTERN · t1.5 · BEND RELIEF 1.5</text>`;
  return s;
}

function bracket(i: DrawInput) {
  const f = i.features;
  let s = `<path d="M80 64h44v148h120v44H80z" fill="rgba(255,255,255,0.35)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
  s += `<path d="M300 64h40v192h-40z" fill="rgba(255,255,255,0.35)" stroke="${INK}" stroke-width="1.6"/>`;
  s += `<g stroke="${INK}" stroke-width="1.2" fill="none"><circle cx="102" cy="96" r="6"/><circle cx="102" cy="156" r="6"/>`;
  s += `<rect x="160" y="226" width="56" height="14" rx="7"/></g>`;
  s += `<text x="160" y="220" font-family="monospace" font-size="8" fill="${FAINT}">SLOT ±10</text>`;
  if (f.holes) s += `<g stroke="${INK}" stroke-width="1.2" fill="none"><circle cx="320" cy="96" r="6"/><circle cx="320" cy="200" r="6"/></g>`;
  s += `<path d="M102 44V276M320 44V276" stroke="${FAINT}" stroke-dasharray="8 4 2 4" stroke-width="0.8"/>`;
  if (f.dimensions) s += dimH(80, 244, 292, "120") + dimV(60, 64, 256, "150") + dimH(300, 340, 292, "6");
  s += `<g font-family="monospace" font-size="9" fill="${FAINT}"><text x="120" y="312">FRONT</text><text x="300" y="312">SIDE</text></g>`;
  return s;
}

function blockDiagram(i: DrawInput) {
  const box = (x: number, y: number, w: number, h: number, label: string, sub: string, hl = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${hl ? "rgba(14,89,197,0.08)" : "rgba(255,255,255,0.5)"}" stroke="${hl ? COBALT : INK}" stroke-width="1.3"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2 - 1}" text-anchor="middle" font-size="11" font-weight="600" fill="${INK}">${esc(label)}</text>` +
    `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" font-size="8.5" fill="${FAINT}" font-family="monospace">${esc(sub)}</text>`;

  let s = `<g stroke="${COBALT}" stroke-width="1.2" fill="none"><path d="M150 84h50M150 158h50M320 84h46M320 158h46M260 210v26"/></g>`;
  s += box(40, 62, 110, 44, "Power in", "solar / mains");
  s += box(40, 136, 110, 44, "Battery", "pack + protection");
  s += box(200, 62, 120, 148, "Controller", "MCU · Wi-Fi", true);
  s += box(366, 62, 112, 44, "Actuator", "motor / pump");
  s += box(366, 136, 112, 44, "Sensors", "level · temp");
  s += box(200, 236, 120, 40, "User app", "status · alerts");
  s += `<text x="40" y="300" font-family="monospace" font-size="9" fill="${FAINT}">${esc(i.code)} · REV ${i.rev} · BLOCK DIAGRAM — not a wiring schematic</text>`;
  return s;
}

export function drawSchematic(i: DrawInput): string {
  const body =
    i.kind === "flat_pattern" ? flatPattern(i)
    : i.kind === "bracket" ? bracket(i)
    : i.kind === "block_diagram" ? blockDiagram(i)
    : outline(i);

  const grid =
    `<defs><pattern id="g" width="28" height="28" patternUnits="userSpaceOnUse">` +
    `<path d="M28 0H0V28" fill="none" stroke="rgba(28,36,52,0.06)" stroke-width="1"/></pattern></defs>` +
    `<rect width="520" height="320" fill="url(#g)"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 320" role="img" aria-label="${esc(i.title)} — revision ${i.rev}">` +
    grid +
    body +
    (i.kind === "block_diagram" ? "" : titleBlock(i)) +
    `</svg>`
  );
}

/**
 * The one case where generation "fails": we cannot draw a flat pattern for a
 * material no sheet process can cut. Surfacing this as a failed revision is
 * more useful than drawing a rectangle that lies.
 */
export function drawingBlocked(kind: SchematicKind, material: string | null): string | null {
  if (kind === "flat_pattern" && material && !["stainless_304", "mild_steel", "aluminium_6061", "brass", "acrylic", "plywood", "mdf"].includes(material))
    return "not_sheet";
  if (kind === "block_diagram" && material !== "fr4") return "not_board";
  return null;
}
