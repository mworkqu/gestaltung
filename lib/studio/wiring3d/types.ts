// Shared types of the 3D wiring layout. Kept apart from layout.ts so rails.ts
// (which layout.ts calls) can use MatLayout without importing layout.ts (import
// cycle). layout.ts re-exports all of them.

import type { LibraryPart } from "../schema";
import type { BreadboardSpec, PlugSet, Rot } from "./breadboard";
import type { Vec3 } from "./pins3d";

export type { Rot };

export type MatItem = { instanceId: string; part: LibraryPart };

export type PlacedHole = { id: string; col: number; row: number };

export type Placement = {
  instanceId: string;
  partId: string;
  /** Part origin on the mat (centre of its footprint; z = the height its model base sits at). */
  pos: Vec3;
  rotZ: Rot;
  /** Footprint as it sits now (mm). */
  w: number;
  d: number;
  h: number;
  board: boolean;
  /** Plugged into the breadboard. */
  breadboard: boolean;
  /** Model pose extras (a DHT22 stands up on the breadboard): tilt about X first, then this offset, then rotZ. */
  tilt: 0 | 90;
  offset: Vec3;
  /** Holes its pins sit in (plugged only). */
  holes?: PlacedHole[];
  /** How it lies on the mat (used when it is unplugged). */
  matPose: { rotZ: Rot; w: number; d: number; h: number };
  /** How it can plug in (pluggable parts only). */
  plug?: PlugSet;
  /** Net of each pin (pluggable parts only; null = not wired). */
  pinNets?: Record<string, string | null>;
};

export type MatLayout = {
  placements: Placement[];
  breadboard: BreadboardSpec | null;
  /** Footprint bounds of everything (incl. the breadboard), mm. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; maxZ: number };
};
