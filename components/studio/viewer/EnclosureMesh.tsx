"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { Colour, Finish } from "@/lib/studio/schema";
import { useViewerCtx } from "./context";
import { makeEnclosureMaterial, type StudioObjectData } from "./materials";

type Props = {
  /** Built by buildEnclosure (geometry owned by the caller). */
  base: THREE.Mesh;
  lid: THREE.Mesh;
  finish: Finish;
  colour: Colour;
  accentColour?: Colour;
  xray: boolean;
};

const XRAY_OPACITY = 0.25;
const XRAY_MS = 250;

function setRest(mesh: THREE.Mesh, kind: "base" | "lid", name: string) {
  mesh.name = name;
  const prev = (mesh.userData as { studio?: StudioObjectData }).studio;
  // Keep the first recorded rest (the explode controller may have moved the mesh since).
  const rest: [number, number, number] = prev?.rest ?? [mesh.position.x, mesh.position.y, mesh.position.z];
  const data: StudioObjectData = { kind, rest };
  mesh.userData.studio = data;
}

/** Enclosure base + lid with finish materials; x-ray fades both to 25 % opacity. */
export default function EnclosureMesh({ base, lid, finish, colour, accentColour, xray }: Props) {
  const { reducedMotion, markDirty, onSelect } = useViewerCtx();
  const invalidate = useThree((s) => s.invalidate);
  const opacity = useRef(xray ? XRAY_OPACITY : 1);

  const mats = useMemo(
    () => ({
      base: makeEnclosureMaterial(finish, colour),
      lid: makeEnclosureMaterial(finish, colour, accentColour),
    }),
    [finish, colour, accentColour],
  );
  useEffect(() => {
    return () => {
      mats.base.dispose();
      mats.lid.dispose();
    };
  }, [mats]);

  useLayoutEffect(() => {
    setRest(base, "base", "enclosure_base");
    setRest(lid, "lid", "enclosure_lid");
    base.material = mats.base;
    lid.material = mats.lid;
    for (const m of [base, lid]) {
      m.receiveShadow = true;
      m.castShadow = opacity.current > 0.99;
    }
    applyOpacity([mats.base, mats.lid], opacity.current);
    markDirty();
  }, [base, lid, mats, markDirty]);

  useEffect(() => {
    invalidate();
  }, [xray, invalidate]);

  useFrame((_, dt) => {
    const goal = xray ? XRAY_OPACITY : 1;
    if (opacity.current === goal) return;
    const step = reducedMotion ? 1 : (Math.min(dt, 0.1) * 1000 * (1 - XRAY_OPACITY)) / XRAY_MS;
    const next = goal < opacity.current ? Math.max(goal, opacity.current - step) : Math.min(goal, opacity.current + step);
    opacity.current = next;
    applyOpacity([mats.base, mats.lid], next);
    base.castShadow = lid.castShadow = next > 0.99;
    if (next !== goal) invalidate();
  });

  // Tapping the closed box clears the selection; in x-ray taps reach the parts inside.
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (xray || e.delta > 4) return;
    e.stopPropagation();
    onSelect(null);
  };

  return (
    <group>
      <primitive object={base} onClick={onClick} />
      <primitive object={lid} onClick={onClick} />
    </group>
  );
}

function applyOpacity(ms: THREE.Material[], o: number) {
  const solid = o > 0.999;
  for (const m of ms) {
    if (m.transparent === solid) {
      m.transparent = !solid;
      m.needsUpdate = true;
    }
    m.opacity = o;
    m.depthWrite = solid;
  }
}
