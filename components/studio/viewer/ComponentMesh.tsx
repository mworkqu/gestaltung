"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { buildPartModel } from "@/lib/studio/models";
import { getPart } from "@/lib/studio/library";
import type { RotZ } from "@/lib/studio/layout";
import { placePart } from "@/lib/studio/placement";
import { useViewerCtx } from "./context";
import { useStlPart } from "./StlModel";
import { cloneMaterials, disposeObject, forEachMaterial, type StudioObjectData } from "./materials";

type Props = {
  instanceId: string;
  partId: string;
  /** Rest position (mm, Z up) and rotation about Z (degrees). */
  rest: [number, number, number];
  rotZ: number;
  layer: number;
  /** Plate mode: gentle bob with this phase (radians). */
  bobPhase?: number;
};

const BOB_AMPLITUDE_MM = 1.6;
const BOB_SPEED = 1.4;

function placeholder(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(20, 20, 6),
    new THREE.MeshStandardMaterial({ color: "#c9d3df", roughness: 0.7 }),
  );
  m.position.z = 3;
  g.add(m);
  return g;
}

type EmissiveBackup = { color: THREE.Color; intensity: number };

/** One library part, built once per partId; its group is named instanceId. */
export default function ComponentMesh({ instanceId, partId, rest, rotZ, layer, bobPhase }: Props) {
  const { selected, onSelect, accent, reducedMotion, markDirty } = useViewerCtx();
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  const model = useMemo(() => {
    const part = getPart(partId);
    let g: THREE.Group;
    try {
      g = part ? buildPartModel(part) : placeholder();
    } catch (err) {
      console.warn("[studio viewer] model build failed", partId, err);
      g = placeholder();
    }
    cloneMaterials(g);
    return g;
  }, [partId]);

  useEffect(() => {
    return () => {
      disposeObject(model);
    };
  }, [model]);

  // An owner-uploaded STL replaces the box placeholder once it has loaded.
  const part = getPart(partId);
  const stl = useStlPart(part?.model.kind === "stl" ? part.model.url : null, part?.dims, part?.look.body);
  const shown = stl ?? model;

  // Rest pose + explode metadata; the explode controller adds its offset on top.
  const [rx, ry, rz] = rest;
  useLayoutEffect(() => {
    const g = outer.current;
    if (!g) return;
    g.name = instanceId;
    // rest is already placePart(...).position (Viewer); rotation from the same helper.
    const { rotationZ } = placePart({ pos: [rx, ry, rz], rotZ: rotZ as RotZ });
    g.position.set(rx, ry, rz);
    g.rotation.set(0, 0, rotationZ);
    const data: StudioObjectData = { kind: "component", rest: [rx, ry, rz], layer };
    g.userData.studio = data;
    markDirty();
  }, [instanceId, rx, ry, rz, rotZ, layer, markDirty]);

  // Selection highlight: emissive tint in the accent colour.
  const isSelected = selected === instanceId;
  useEffect(() => {
    forEachMaterial(shown, (m) => {
      const sm = m as THREE.MeshStandardMaterial;
      if (!sm.emissive) return;
      const ud = sm.userData as { emissiveBackup?: EmissiveBackup };
      if (!ud.emissiveBackup) ud.emissiveBackup = { color: sm.emissive.clone(), intensity: sm.emissiveIntensity };
      if (isSelected) {
        sm.emissive.copy(accent);
        sm.emissiveIntensity = 0.35;
      } else {
        sm.emissive.copy(ud.emissiveBackup.color);
        sm.emissiveIntensity = ud.emissiveBackup.intensity;
      }
    });
    invalidate();
  }, [shown, isSelected, accent, invalidate]);

  const bobbing = bobPhase !== undefined && !reducedMotion;
  useEffect(() => {
    if (!bobbing && inner.current) {
      inner.current.position.z = bobPhase !== undefined ? BOB_AMPLITUDE_MM : 0;
      invalidate();
    }
  }, [bobbing, bobPhase, invalidate]);

  useFrame((state) => {
    if (!bobbing || !inner.current) return;
    const t = state.clock.elapsedTime;
    inner.current.position.z = BOB_AMPLITUDE_MM * (1 + Math.sin(t * BOB_SPEED + (bobPhase ?? 0)));
    invalidate();
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // a drag, not a tap
    e.stopPropagation();
    onSelect(instanceId);
  };

  return (
    <group
      ref={outer}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        gl.domElement.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        gl.domElement.style.cursor = "";
      }}
    >
      <group ref={inner}>
        <primitive object={shown} />
      </group>
    </group>
  );
}
