// Cheap static "3D shape" thumbnail for the Studio parts list (D7): an isometric
// box drawn from the part's real size, tinted by its look. Pure SVG geometry, no
// three.js, so a list of 40 rows costs nothing.

export type IsoBox = { top: string; left: string; right: string; width: number; height: number };

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

export const LOOK_HEX: Record<string, string> = {
  pcb_green: "#2f8f5b",
  pcb_black: "#2b2f36",
  pcb_blue: "#2c6fb7",
  metal: "#a9b2bd",
  plastic_black: "#3a3f47",
  plastic_white: "#e8e6df",
  battery_wrap: "#3f7fa6",
};

/** Shade a #rrggbb colour: factor < 1 darkens, > 1 lightens (clamped). */
export function shade(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const pts = (a: [number, number][]) => a.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Isometric box for dims (x wide, y deep, z tall, mm) fitted into a size x size
 * square. Returns the three visible faces as SVG polygon points.
 */
export function isoBox(dims: { x: number; y: number; z: number }, size = 56): IsoBox {
  const pad = 3;
  const x = Math.max(dims.x, 0.1);
  const y = Math.max(dims.y, 0.1);
  const z = Math.max(dims.z, 0.1);
  // Unit-free extents of the projected box.
  const w = (x + y) * COS;
  const h = (x + y) * SIN + z;
  const k = (size - pad * 2) / Math.max(w, h);
  const a = x * k;
  const b = y * k;
  const c = z * k;
  const width = (a + b) * COS;
  const height = (a + b) * SIN + c;
  const ox = (size - width) / 2;
  const oy = (size - height) / 2;
  // Corner anchors: leftmost point of the top face is (ox, oy + b*SIN).
  const topLeft: [number, number] = [ox, oy + b * SIN];
  const topBack: [number, number] = [ox + b * COS, oy];
  const topRight: [number, number] = [ox + (a + b) * COS, oy + a * SIN];
  const topFront: [number, number] = [ox + a * COS, oy + (a + b) * SIN];
  const down = (p: [number, number]): [number, number] => [p[0], p[1] + c];
  return {
    top: pts([topLeft, topBack, topRight, topFront]),
    left: pts([topLeft, topFront, down(topFront), down(topLeft)]),
    right: pts([topFront, topRight, down(topRight), down(topFront)]),
    width: round(width),
    height: round(height),
  };
}
