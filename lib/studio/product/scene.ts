// Scene metrics (P5-16): the few numbers the solver needs about where a product
// lives. The scene props themselves (pot, soil, leaves, desk, wall, hand…) are
// drawn by the viewer (Phase 2b) from these same numbers (SolvedProduct.stage)
// and are never exported.
//
// World frame: mm, Z up, −y = the front (towards the viewer).
//  * groundZ: what "ground" means for attach.to = "ground" (the soil surface in a pot,
//    the desk top, the floor). Stakes may go below it; nothing else.
//  * floorZ:  what attach.to = "scene" + anchor bottom stands on (the table under the
//    pot, so a reservoir sits BESIDE the pot).
//  * wallY:   attach.to = "scene" + anchor back puts the body's back on this plane.
//  * obstacles: solid scene volumes no body may enter (the pot wall, the soil), except
//    the roles listed in `inside` (a stake lives in the soil).

import type { Box3 } from "./shapes";
import type { BodyRole, Scene } from "./schema";

/** A solid scene volume: a box, or a ring about the z axis (a pot wall; rIn 0 = a disc). */
export type Obstacle =
  | { name: string; kind: "box"; box: Box3; inside: readonly BodyRole[] }
  | { name: string; kind: "ring"; rIn: number; rOut: number; z0: number; z1: number; inside: readonly BodyRole[] };

/** A body's footprint for ring tests: its world box, or a circle when the body is round. */
export type Footprint = { box: Box3; circle?: { cx: number; cy: number; r: number } };

/** Does a body enter the obstacle (by more than 0.5 mm)? */
export function obstacleHit(fp: Footprint, ob: Obstacle): boolean {
  const { box } = fp;
  const zOver = Math.min(box.max[2], ob.kind === "box" ? ob.box.max[2] : ob.z1) - Math.max(box.min[2], ob.kind === "box" ? ob.box.min[2] : ob.z0);
  if (zOver <= 0.5) return false;
  if (ob.kind === "box") {
    return [0, 1].every((k) => Math.min(box.max[k], ob.box.max[k]) - Math.max(box.min[k], ob.box.min[k]) > 0.5);
  }
  let near: number;
  let far: number;
  if (fp.circle) {
    const d = Math.hypot(fp.circle.cx, fp.circle.cy);
    near = Math.max(0, d - fp.circle.r);
    far = d + fp.circle.r;
  } else {
    near = Math.hypot(Math.max(box.min[0], Math.min(0, box.max[0])), Math.max(box.min[1], Math.min(0, box.max[1])));
    far = Math.hypot(Math.max(Math.abs(box.min[0]), Math.abs(box.max[0])), Math.max(Math.abs(box.min[1]), Math.abs(box.max[1])));
  }
  return far > ob.rIn + 0.5 && near < ob.rOut - 0.5;
}

export type SceneMetrics = {
  groundZ: number;
  floorZ: number;
  wallY: number;
  /** Height of a wall-mounted product's centre above the floor (scene "back" attach). */
  mountZ: number;
  obstacles: Obstacle[];
  /** Where water / a nozzle should aim (plant pot: the soil disc). */
  target?: { centre: [number, number, number]; radius: number };
  /** plant_pot: the pot the viewer draws (outer radius, wall, rim height above the soil, depth). */
  pot?: { radius: number; wall: number; rimAbove: number; depth: number };
};

/** Default plant pot: Ø 150 mm, rim 10 mm above the soil, 110 mm of pot under the soil, on a table. */
export const POT = { radius: 75, wall: 6, rimAbove: 10, depth: 110 } as const;

/** A plant-pot scene with a pot of the given outer radius (the solver widens it for big products). */
export function plantPot(radius: number = POT.radius): SceneMetrics {
  const pot = { ...POT, radius };
  return {
    groundZ: 0,
    floorZ: -pot.depth,
    wallY: 0,
    mountZ: 0,
    obstacles: [
      { name: "pot", kind: "ring", rIn: radius - pot.wall, rOut: radius, z0: -pot.depth, z1: pot.rimAbove, inside: [] },
      { name: "soil", kind: "ring", rIn: 0, rOut: radius, z0: -pot.depth, z1: -0.5, inside: ["stake"] },
    ],
    target: { centre: [0, 0, 0], radius: radius - pot.wall },
    pot,
  };
}

export const SCENE_METRICS: Record<Scene, SceneMetrics> = {
  plant_pot: plantPot(),
  desk: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 0, obstacles: [] },
  wall: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 150, obstacles: [] },
  hand: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 0, obstacles: [] },
  floor: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 0, obstacles: [] },
  car_dash: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 60, obstacles: [] },
  outdoor: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 0, obstacles: [] },
  pet_bowl: { groundZ: 0, floorZ: 0, wallY: 0, mountZ: 0, obstacles: [] },
};
