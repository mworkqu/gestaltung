"use client";

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { explodeOffset, type Vec3 } from "@/lib/studio/explode";
import { studioData } from "./materials";

type Props = {
  /** Group whose descendants carry userData.studio (Z-up content frame). */
  root: RefObject<THREE.Group | null>;
  /** Target explode amount 0..1. */
  target: number;
  centre: Vec3;
  /** Enclosure (or content) height, mm. */
  H: number;
  reducedMotion: boolean;
  /** Set by children when an object or its rest pose changes. */
  dirty: MutableRefObject<boolean>;
  /** Called once the animation reaches its target (e.g. to re-bake contact shadows). */
  onSettled?(): void;
};

const DAMPING = 7;

/** Moves every studio object to rest + explodeOffset(…, eased t). t = 0 is the exact rest pose. */
export default function ExplodeController({ root, target, centre, H, reducedMotion, dirty, onSettled }: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const current = useRef(0);
  const goal = Math.min(1, Math.max(0, Number.isFinite(target) ? target : 0));

  useEffect(() => {
    invalidate();
  }, [goal, centre, H, invalidate]);

  useFrame((_, dt) => {
    const prev = current.current;
    let next = reducedMotion ? goal : THREE.MathUtils.damp(prev, goal, DAMPING, Math.min(dt, 0.1));
    if (Math.abs(next - goal) < 1e-3) next = goal;
    const moved = next !== prev;
    if (!moved && !dirty.current) return;
    current.current = next;
    dirty.current = false;
    const g = root.current;
    if (g) {
      g.traverse((o) => {
        const s = studioData(o);
        if (!s) return;
        const off = explodeOffset(s.kind, s.rest, centre, H, s.layer ?? 0, next, s.vector);
        o.position.set(s.rest[0] + off[0], s.rest[1] + off[1], s.rest[2] + off[2]);
      });
    }
    if (next !== goal) invalidate();
    else if (moved) onSettled?.();
  });

  return null;
}
