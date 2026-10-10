"use client";

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { explodeOffset, type ExplodeFrame } from "@/lib/studio/explode";
import { studioData } from "./materials";

type Props = {
  /** Group whose descendants carry userData.studio (Z-up content frame). */
  root: RefObject<THREE.Group | null>;
  /** Target explode amount 0..1. */
  target: number;
  /** Centre, height, tallest part, layers, span (explode.ts explodeFrame). */
  frame: ExplodeFrame;
  reducedMotion: boolean;
  /** Set by children when an object or its rest pose changes. */
  dirty: MutableRefObject<boolean>;
  /** Called once the animation reaches its target (e.g. to re-bake contact shadows). */
  onSettled?(): void;
};

/** One explode / collapse takes this long (wall-clock, so slow frames never leave it half-way). */
const DURATION_MS = 650;

/** Moves every studio object to rest + explodeOffset(…, eased t). t = 0 is the exact rest pose. */
export default function ExplodeController({ root, target, frame, reducedMotion, dirty, onSettled }: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const current = useRef(0);
  const anim = useRef({ from: 0, to: 0, start: 0 });
  const goal = Math.min(1, Math.max(0, Number.isFinite(target) ? target : 0));

  useEffect(() => {
    invalidate();
  }, [goal, frame, invalidate]);

  // A new frame (other parts / case) re-applies the current pose.
  useEffect(() => {
    dirty.current = true;
  }, [frame, dirty]);

  useFrame(() => {
    const prev = current.current;
    const now = performance.now();
    if (anim.current.to !== goal) anim.current = { from: prev, to: goal, start: now };
    const a = anim.current;
    // Linear in time; explodeOffset eases it. Ends exactly on the goal (reversible).
    const k = Math.min(1, (now - a.start) / (DURATION_MS * Math.max(0.15, Math.abs(a.to - a.from))));
    let next = reducedMotion || k >= 1 ? goal : a.from + (a.to - a.from) * k;
    if (Math.abs(next - goal) < 1e-4) next = goal;
    const moved = next !== prev;
    if (!moved && !dirty.current) return;
    current.current = next;
    dirty.current = false;
    const g = root.current;
    if (g) {
      g.traverse((o) => {
        const s = studioData(o);
        if (!s) return;
        const off = explodeOffset(s.kind, s.rest, frame, s.layer ?? 0, next, s.vector);
        o.position.set(s.rest[0] + off[0], s.rest[1] + off[1], s.rest[2] + off[2]);
      });
    }
    if (next !== goal) invalidate();
    else if (moved) onSettled?.();
  });

  return null;
}
