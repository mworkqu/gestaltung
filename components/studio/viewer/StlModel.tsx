"use client";

// STL library parts in the 3D viewer (P5-15c). useStlPart(url, dims, look)
// loads the owner's uploaded mesh (studio-models bucket) once per URL, places
// it in the part frame (lib/studio/library/stl-fit.ts: mm, x/y centred, bottom
// on z = 0, scaled only when it is far from dims) and returns a fresh group,
// or null while loading / on error (the caller keeps the placeholder box).
// STLLoader is imported on demand so it only loads when an STL part is shown.

import { useEffect, useState } from "react";
import * as THREE from "three";

import { mat } from "@/lib/studio/models";
import type { Look } from "@/lib/studio/schema";
import { stlFit, type Dims } from "@/lib/studio/library/stl-fit";

const cache = new Map<string, Promise<THREE.BufferGeometry>>();

function loadGeometry(url: string): Promise<THREE.BufferGeometry> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`STL ${res.status}`);
      const geo = new STLLoader().parse(await res.arrayBuffer());
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      return geo;
    })();
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** A group holding the STL, placed in the part frame for these dims. */
export function stlGroup(geo: THREE.BufferGeometry, dims: Dims, look: Look | string = "plastic_black"): THREE.Group {
  const bb = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox!);
  const fit = stlFit({ min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] }, dims);
  const mesh = new THREE.Mesh(geo, mat(look));
  mesh.name = "stl";
  mesh.scale.setScalar(fit.scale);
  mesh.position.set(...fit.offset);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

export function useStlPart(url: string | null | undefined, dims: Dims | undefined, look?: Look | string): THREE.Group | null {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const dx = dims?.x ?? 0;
  const dy = dims?.y ?? 0;
  const dz = dims?.z ?? 0;
  useEffect(() => {
    if (!url || !dx || !dy || !dz) {
      setGroup(null);
      return;
    }
    let alive = true;
    let made: THREE.Group | null = null;
    loadGeometry(url)
      .then((geo) => {
        if (!alive) return;
        made = stlGroup(geo, { x: dx, y: dy, z: dz }, look);
        setGroup(made);
      })
      .catch((e) => {
        console.warn("[studio viewer] STL failed to load", url, e instanceof Error ? e.message : e);
        if (alive) setGroup(null);
      });
    return () => {
      alive = false;
      // The geometry is shared through the cache; only the material is ours.
      made?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        m?.dispose?.();
      });
    };
  }, [url, dx, dy, dz, look]);
  return group;
}
