// Flat "wiring drawing" of a library part (P5-17): outline, colour and pins on
// the part's left / right edges at 2.54 mm pitch. DERIVED from data the part
// already has (pins + pin.side, procedural model rows, dims, look); only a few
// parts need a nudge (OVERRIDES, or LibraryPart.drawing2d).
//
// Conventions of the output (millimetres, origin top-left, y down):
//   * every pin sits on the LEFT or the RIGHT edge (x = 0 or x = w), so a wire
//     always leaves a pin sideways, perpendicular to the header;
//   * boards whose headers run along the long side are turned 90° so the
//     header is a vertical row; top/bottom headers become left/right ones;
//   * a part with 3 pins or fewer has them all on one (the right) edge — the
//     drawing flips it so that edge faces the board;
//   * pins of one edge are 2.54 mm apart and centred on the edge.
//
// Pure and client-safe. Same input → same output.

import { LOOK_HEX } from "./palette";
import { symbolKind } from "./netlist";
import type { LibraryPart, Pin } from "./schema";
import { round2 } from "@/lib/format/money";

export const PITCH_MM = 2.54;
/** Body never smaller than this (mm) so labels and a pin row fit. */
const MIN_MM = 8;

export type Edge = "left" | "right";
export type Decor = "none" | "chip" | "screen" | "led" | "resistor" | "ring";

export type Pin2D = { id: string; edge: Edge; x: number; y: number };

export type Drawing2D = {
  /** Outline in mm. */
  w: number;
  h: number;
  /** Body colour and a text colour that reads on it. */
  colour: string;
  textColour: string;
  accent?: string;
  decor: Decor;
  /** Resistor colour bands (hex), when decor is "resistor". */
  bands?: string[];
  /** In library pin order. */
  pins: Pin2D[];
  /** The edge with most pins (ties: right) — the one that should face the board. */
  dominant: Edge;
};

type Override = Partial<{ w: number; h: number; colour: string; decor: Decor; edges: Record<string, Edge> }>;

/** Small explicit nudges where the derivation looks wrong. */
export const OVERRIDES: Record<string, Override> = {
  ws2812_ring: { decor: "ring" },
  dht22: { colour: "#4f8fd6" },
};

/** Luminance-based text colour for a hex body colour. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#1c2434" : "#ffffff";
}

function procParams(p: LibraryPart): Record<string, unknown> {
  return p.model.kind === "procedural" ? p.model.params : {};
}
const builderOf = (p: LibraryPart): string => (p.model.kind === "procedural" ? p.model.builder : "");

type Row = { x?: number; y?: number; axis?: string };
/** Procedural header rows run along x (a row at a fixed y) unless they say axis "y". */
function rowsAlongX(p: LibraryPart): boolean {
  const rows = procParams(p).rows;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return (rows as Row[]).some((r) => r.axis !== "y" && typeof r.y === "number");
}

function decorOf(p: LibraryPart): Decor {
  switch (builderOf(p)) {
    case "oledDisplay":
    case "lcdModule":
      return "screen";
    case "led":
      return "led";
    case "resistor":
      return "resistor";
    case "ledRing":
      return "ring";
    case "devBoard":
    case "moduleBoard":
      return p.pins.length > 4 ? "chip" : "none";
    default:
      return p.category === "mcu" ? "chip" : "none";
  }
}

/** Which edge a pin takes in the drawing. */
function edgeOf(pin: Pin, hasLR: boolean, hasTB: boolean, few: boolean): Edge {
  if (few) return "right";
  if (pin.side === "left") return "left";
  if (pin.side === "right") return "right";
  if (pin.side === "top") return "left";
  if (pin.side === "bottom") return "right";
  return hasLR || hasTB ? "right" : "right";
}

export function drawing2d(p: LibraryPart): Drawing2D {
  const ov: Override = { ...OVERRIDES[p.id], ...p.drawing2d };
  const sides = new Set(p.pins.map((x) => x.side).filter(Boolean));
  const hasLR = sides.has("left") || sides.has("right");
  const hasTB = sides.has("top") || sides.has("bottom");
  const resistor = symbolKind(p) === "resistor";
  const few = p.pins.length <= 3 && !resistor;

  // Rotate when the header runs along the long axis: top/bottom headers, or
  // left/right headers that are rows parallel to x (ESP32, Nano, Pico, shifter).
  const rotated = hasTB || (hasLR && rowsAlongX(p));
  let w = rotated ? p.dims.y : p.dims.x;
  let h = rotated ? p.dims.x : p.dims.y;

  const pinsOut: Pin2D[] = [];
  const perEdge: Record<Edge, Pin[]> = { left: [], right: [] };
  for (const pin of p.pins) {
    const e = ov.edges?.[pin.id] ?? edgeOf(pin, hasLR, hasTB, few);
    perEdge[e].push(pin);
  }
  const most = Math.max(perEdge.left.length, perEdge.right.length, 1);
  w = Math.max(ov.w ?? w, MIN_MM);
  h = Math.max(ov.h ?? h, MIN_MM, (most - 1) * PITCH_MM + 2 * PITCH_MM);

  for (const e of ["left", "right"] as const) {
    const list = perEdge[e];
    list.forEach((pin, i) => {
      pinsOut.push({
        id: pin.id,
        edge: e,
        x: e === "left" ? 0 : w,
        y: round2((h - (list.length - 1) * PITCH_MM) / 2 + i * PITCH_MM),
      });
    });
  }
  // Library order.
  const order = new Map(p.pins.map((x, i) => [x.id, i]));
  pinsOut.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const colour = ov.colour ?? LOOK_HEX[p.look.body];
  const params = procParams(p);
  const bands = Array.isArray(params.bands) ? (params.bands as unknown[]).filter((b): b is string => typeof b === "string") : undefined;
  return {
    w: round2(w),
    h: round2(h),
    colour,
    textColour: textOn(colour),
    accent: p.look.accent,
    decor: ov.decor ?? decorOf(p),
    bands,
    pins: pinsOut,
    dominant: perEdge.left.length > perEdge.right.length ? "left" : "right",
  };
}

