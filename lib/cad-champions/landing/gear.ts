// Spur gear outlines for the landing hero (pure). One outline feeds both the
// static SVG drawing and the three.js extrusion, so the fallback and the live
// model show the same gear pair.

export type GearSpec = {
  teeth: number;
  /** Module in scene units: pitch diameter = module x teeth. */
  module: number;
};

export type GearDims = { pitch: number; outer: number; root: number };

export function gearDims(g: GearSpec): GearDims {
  return {
    pitch: (g.module * g.teeth) / 2,
    outer: (g.module * (g.teeth + 2)) / 2,
    root: (g.module * (g.teeth - 2.5)) / 2,
  };
}

/**
 * Closed outline (counter-clockwise) of a simple trapezoid-tooth gear. Tooth k
 * is centred at angle k x 2pi/teeth + phase. 4 points per tooth.
 */
export function gearOutline(g: GearSpec, phase = 0): [number, number][] {
  const { outer, root } = gearDims(g);
  const pitchAngle = (2 * Math.PI) / g.teeth;
  const rootHalf = pitchAngle * 0.3;
  const tipHalf = pitchAngle * 0.15;
  const pts: [number, number][] = [];
  const at = (r: number, a: number): [number, number] => [round(r * Math.cos(a)), round(r * Math.sin(a))];
  for (let k = 0; k < g.teeth; k++) {
    const c = k * pitchAngle + phase;
    pts.push(at(root, c - rootHalf), at(outer, c - tipHalf), at(outer, c + tipHalf), at(root, c + rootHalf));
  }
  return pts;
}

/** Centre distance of two meshing gears with the same module. */
export function centreDistance(a: GearSpec, b: GearSpec): number {
  return gearDims(a).pitch + gearDims(b).pitch;
}

/** Phase for the driven gear (placed on +x of the driver) so a tooth meets a gap. */
export function meshPhase(driven: GearSpec): number {
  return Math.PI + Math.PI / driven.teeth;
}

/** SVG path data for an outline, offset by (cx, cy). */
export function outlineToPath(points: readonly [number, number][], cx = 0, cy = 0): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M${round(first[0] + cx)} ${round(first[1] + cy)}${rest.map(([x, y]) => `L${round(x + cx)} ${round(y + cy)}`).join("")}Z`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The two gears the hero shows (driver 18 teeth, driven 12 teeth). */
export const HERO_GEARS = {
  driver: { teeth: 18, module: 0.18 },
  driven: { teeth: 12, module: 0.18 },
} as const satisfies Record<string, GearSpec>;
