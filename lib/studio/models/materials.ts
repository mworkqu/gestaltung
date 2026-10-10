// Shared, cached material factory for the procedural component models.
// Only MeshStandardMaterial / MeshPhysicalMaterial are used (see types.ts).
// Materials are shared between meshes and between builds, so callers must NOT
// mutate or dispose them.

import * as THREE from "three";
import type { Look } from "../schema";
import { LOOK_HEX } from "../palette";

export type MatOpts = {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Use MeshPhysicalMaterial (needed for clearcoat / transmission). */
  physical?: boolean;
  clearcoat?: number;
  transmission?: number;
  opacity?: number;
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Named finishes that read well at a glance. */
const LOOK_DEFAULTS: Record<Look, MatOpts> = {
  pcb_green: { roughness: 0.55, metalness: 0.05 },
  pcb_black: { roughness: 0.5, metalness: 0.05 },
  pcb_blue: { roughness: 0.5, metalness: 0.05 },
  metal: { roughness: 0.3, metalness: 0.9 },
  plastic_black: { roughness: 0.45, metalness: 0 },
  plastic_white: { roughness: 0.5, metalness: 0 },
  battery_wrap: { roughness: 0.4, metalness: 0.1 },
};

function isLook(v: string): v is Look {
  return Object.prototype.hasOwnProperty.call(LOOK_HEX, v);
}

/** mat("pcb_green") or mat("#d8c9a0", { roughness: 0.8 }). */
export function mat(lookOrHex: Look | string, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  const look = isLook(lookOrHex) ? lookOrHex : null;
  const color = look ? LOOK_HEX[look] : lookOrHex;
  const o: MatOpts = { ...(look ? LOOK_DEFAULTS[look] : { roughness: 0.6, metalness: 0 }), ...opts };
  const key = `${color}|${JSON.stringify(o)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const common = {
    color: new THREE.Color(color),
    roughness: o.roughness ?? 0.6,
    metalness: o.metalness ?? 0,
    emissive: new THREE.Color(o.emissive ?? "#000000"),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: (o.opacity ?? 1) < 1,
    opacity: o.opacity ?? 1,
  };
  const m =
    o.physical || o.clearcoat !== undefined || o.transmission !== undefined
      ? new THREE.MeshPhysicalMaterial({
          ...common,
          clearcoat: o.clearcoat ?? 0,
          clearcoatRoughness: 0.15,
          transmission: o.transmission ?? 0,
        })
      : new THREE.MeshStandardMaterial(common);
  cache.set(key, m);
  return m;
}

/** Frequently used finishes. */
export const METAL = () => mat("metal");
export const GOLD = () => mat("#d4af37", { roughness: 0.3, metalness: 0.9 });
export const BLACK = () => mat("plastic_black");
