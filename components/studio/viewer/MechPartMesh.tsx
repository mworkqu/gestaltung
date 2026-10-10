"use client";

import { useLayoutEffect } from "react";
import type * as THREE from "three";
import { useViewerCtx } from "./context";
import type { StudioObjectData } from "./materials";

type Props = {
  name: string;
  /** Owned by the caller (never disposed here). */
  object: THREE.Object3D;
  explode?: [number, number, number];
};

/** Generic holder for Phase 2 mech parts / any caller-built Object3D. */
export default function MechPartMesh({ name, object, explode }: Props) {
  const { markDirty } = useViewerCtx();
  const [ex, ey, ez] = explode ?? [0, 0, 0];

  useLayoutEffect(() => {
    const rest: [number, number, number] = [object.position.x, object.position.y, object.position.z];
    object.name = name;
    const data: StudioObjectData = { kind: "extra", rest, vector: [ex, ey, ez] };
    object.userData.studio = data;
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    markDirty();
    return () => {
      // Hand the object back exactly as we got it.
      object.position.set(rest[0], rest[1], rest[2]);
      delete object.userData.studio;
    };
  }, [object, name, ex, ey, ez, markDirty]);

  return <primitive object={object} />;
}
