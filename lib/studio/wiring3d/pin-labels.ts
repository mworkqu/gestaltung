// 3D wiring (P5-17h): pin names printed on the parts, like a board's silkscreen.
//
// Pure (no three.js). For every pin of a part: its short name (pinLabel():
// GND, 5V, 3V3, GPIO4, VCC, "+"/"−" on an LED …) in a small box BESIDE the
// pin, in the part's own model frame (mm, Z up, centred). The 3D view draws
// all of a part's boxes into ONE canvas texture laid flat on the part
// (pinLabelLayout().z) as a decal.
//
// Rules:
//  * a label runs away from its pin, perpendicular to the pin's header row
//    (a row along X → labels along Y), on the board side of the row when it
//    fits (like real silkscreen), else on the other side; a lone pin points
//    away from the part's centre;
//  * it clears the header plastic (GAP) and never overlaps another label or
//    another pin, nor a tall part on the board (`obstacles`, e.g. the chip or
//    the USB socket the view measures on the model) — then it goes to the
//    other side of the row; a crowded spot gets a smaller font before giving up;
//  * text is never upside down from the default camera: the reading
//    direction, after the part's rotZ on the mat, is +x or +y (`angle`).

import { pinLabel } from "../connections";
import type { LibraryPart } from "../schema";
import { pins3dFor, PITCH } from "./pins3d";

type Rot = 0 | 90 | 180 | 270;
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type PinLabel = {
  pin: string;
  text: string;
  /** Pin position (x, y) in the model frame. */
  anchor: [number, number];
  /** The label's box in the model frame. */
  box: Box;
  /** Reading direction in the model frame, degrees CCW from +x (0 / 90 / 180 / 270). */
  angle: Rot;
  /** Text height (mm). */
  size: number;
  /** Lies on the dark board (light text); false = beside it on the light mat / breadboard (dark text). */
  onDark: boolean;
};

export type PinLabelLayout = {
  labels: PinLabel[];
  /** Height of the surface the labels lie on (model frame). */
  z: number;
  /** Labels lie on a dark board (light text) or on the light mat / breadboard (dark text). */
  onDark: boolean;
  /** Box around every label (the decal's extent). */
  bounds: Box;
};

/** Text height (mm) and the smaller one used where it is crowded. */
export const LABEL_SIZE = 1.45;
const SMALL_SIZE = 1.05;
/** Width of one monospace character as a share of the text height. */
export const CHAR_W = 0.62;
/** Distance from the pin centre to the label (clears a 2.54 mm header body). */
const GAP = 1.75;
/** Square kept free around each pin (mm). */
const PIN_KEEP = 1.9;

const DARK_LOOKS = new Set(["pcb_green", "pcb_black", "pcb_blue", "plastic_black", "metal"]);
const BOARD_BUILDERS = new Set(["devBoard", "moduleBoard", "oledDisplay", "lcdModule", "ledRing", "chargerBoard", "speakerAmp"]);

const overlap = (a: Box, b: Box, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** The surface the labels lie on (model frame). */
function surfaceZ(part: LibraryPart): number {
  if (part.model.kind !== "procedural") return 0.15;
  const p = part.model.params;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  switch (part.model.builder) {
    case "devBoard":
      return n(p.boardT, 1.6);
    case "moduleBoard":
      return n(p.boardZ, 0) + n(p.boardT, 1.6);
    case "oledDisplay":
      return 1.2;
    case "ledRing":
      return 1.6;
    case "chargerBoard":
    case "speakerAmp":
      return n(p.boardT, 1.2);
    default:
      return 0.15;
  }
}

function textWidth(text: string, size: number) {
  return Math.max(1, [...text].length) * size * CHAR_W + size * 0.5;
}

/** Reading angle along ±dir that stays readable after rotZ (reads toward +x or +y on the mat). */
function readable(dir: [number, number], rot: Rot): Rot {
  const a = dir[0] > 0.5 ? 0 : dir[0] < -0.5 ? 180 : dir[1] > 0.5 ? 90 : 270;
  const onMat = (a + rot) % 360;
  return (onMat === 0 || onMat === 90 ? a : (a + 180) % 360) as Rot;
}

/** Labels for every pin of `part` (model frame); `rot` = how the part lies on the mat. */
export function pinLabelLayout(part: LibraryPart, rot: Rot = 0, obstacles: Box[] = []): PinLabelLayout {
  const pins = pins3dFor(part);
  const z = surfaceZ(part);
  const isBoard = part.model.kind === "procedural" && BOARD_BUILDERS.has(part.model.builder);
  const onDark = isBoard && DARK_LOOKS.has(part.look.body);
  const list = part.pins.filter((p) => pins[p.id]).map((p) => ({ id: p.id, text: pinLabel(part, p), x: pins[p.id].pos[0], y: pins[p.id].pos[1] }));
  const keep: Box[] = list.map((p) => ({ x0: p.x - PIN_KEEP / 2, y0: p.y - PIN_KEEP / 2, x1: p.x + PIN_KEEP / 2, y1: p.y + PIN_KEEP / 2 }));
  const hx = part.dims.x / 2;
  const hy = part.dims.y / 2;
  const footprint: Box = { x0: -hx, y0: -hy, x1: hx, y1: hy };
  const near = (a: number, b: number) => Math.abs(a - b) < 0.35;
  const placed: PinLabel[] = [];

  // Header-row parts first (longest rows), so their neat columns win the space.
  const order = list
    .map((p, i) => ({ p, i, rowX: list.filter((q) => near(q.y, p.y) && Math.abs(q.x - p.x) <= PITCH * 1.25 * list.length).length, rowY: list.filter((q) => near(q.x, p.x)).length }))
    .sort((a, b) => Math.max(b.rowX, b.rowY) - Math.max(a.rowX, a.rowY) || a.i - b.i);

  for (const { p, i } of order) {
    const alongX = list.some((q) => q !== p && near(q.y, p.y) && Math.abs(q.x - p.x) < PITCH * 1.3);
    const alongY = list.some((q) => q !== p && near(q.x, p.x) && Math.abs(q.y - p.y) < PITCH * 1.3);
    const dirs: [number, number][] = [];
    if (alongX && !alongY) dirs.push([0, p.y > 0 ? -1 : 1], [0, p.y > 0 ? 1 : -1]);
    else if (alongY && !alongX) dirs.push([p.x > 0 ? -1 : 1, 0], [p.x > 0 ? 1 : -1, 0]);
    else {
      // A lone pin (or a grid): away from the centre along the main axis, then the rest.
      const out: [number, number] = Math.abs(p.x) / Math.max(hx, 1) >= Math.abs(p.y) / Math.max(hy, 1) ? [p.x >= 0 ? 1 : -1, 0] : [0, p.y >= 0 ? 1 : -1];
      dirs.push(out, [-out[0], -out[1]], [out[1], out[0]], [-out[1], -out[0]]);
    }
    let best: PinLabel | null = null;
    let fallback: PinLabel | null = null;
    for (const size of [LABEL_SIZE, SMALL_SIZE]) {
      for (const d of dirs) {
        const len = textWidth(p.text, size);
        const a0 = GAP;
        const a1 = GAP + len;
        const h = size * 1.15;
        const cx0 = p.x + d[0] * a0;
        const cx1 = p.x + d[0] * a1;
        const cy0 = p.y + d[1] * a0;
        const cy1 = p.y + d[1] * a1;
        const box: Box =
          d[0] !== 0
            ? { x0: Math.min(cx0, cx1), x1: Math.max(cx0, cx1), y0: p.y - h / 2, y1: p.y + h / 2 }
            : { x0: p.x - h / 2, x1: p.x + h / 2, y0: Math.min(cy0, cy1), y1: Math.max(cy0, cy1) };
        const label: PinLabel = { pin: p.id, text: p.text, anchor: [p.x, p.y], box, angle: readable(d, rot), size, onDark: false };
        fallback ??= label;
        if (placed.some((q) => overlap(q.box, box, 0.15))) continue;
        if (keep.some((k, j) => j !== i && overlap(k, box))) continue;
        if (obstacles.some((o) => overlap(o, box))) continue;
        // On a board, stay on the board when the first choice allows it.
        if (isBoard && !(box.x0 >= footprint.x0 && box.x1 <= footprint.x1 && box.y0 >= footprint.y0 && box.y1 <= footprint.y1) && d === dirs[0]) {
          continue;
        }
        best = label;
        break;
      }
      if (best) break;
    }
    // Nothing free: the smallest label on the first side, kept only if it touches no other label.
    const pick = best ?? (fallback && !placed.some((q) => overlap(q.box, fallback!.box)) ? fallback : null);
    if (pick) {
      const b = pick.box;
      pick.onDark = onDark && b.x0 >= footprint.x0 - 0.2 && b.x1 <= footprint.x1 + 0.2 && b.y0 >= footprint.y0 - 0.2 && b.y1 <= footprint.y1 + 0.2;
      placed.push(pick);
    }
  }

  placed.sort((a, b) => part.pins.findIndex((q) => q.id === a.pin) - part.pins.findIndex((q) => q.id === b.pin));
  const bounds = placed.reduce<Box>(
    (b, l) => ({ x0: Math.min(b.x0, l.box.x0), y0: Math.min(b.y0, l.box.y0), x1: Math.max(b.x1, l.box.x1), y1: Math.max(b.y1, l.box.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  return { labels: placed, z, onDark, bounds: placed.length ? bounds : { x0: 0, y0: 0, x1: 0, y1: 0 } };
}

/** For tests: pairs of labels whose boxes overlap. */
export function overlappingLabels(layout: PinLabelLayout): [string, string][] {
  const out: [string, string][] = [];
  const l = layout.labels;
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (overlap(l[i].box, l[j].box)) out.push([l[i].pin, l[j].pin]);
  return out;
}
