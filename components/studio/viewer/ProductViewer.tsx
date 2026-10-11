"use client";

// The product in 3D after "Create my CAD" (P5-16 Phase 2b). Load it ONLY
// through ProductViewerLazy.tsx (next/dynamic, ssr:false).
//
// Plain three.js (no R3F): it draws exactly what the worker drew for the
// preview picture — the same props, lights, ACES look and finishes from
// lib/studio/product/scene — so the 3D view opens looking like the picture the
// client chose. Z up, mm (the solver's frame); camera.up = +Z.
//
//  * "Take it apart": every printed piece moves by its explode vector × t, each
//    electronic part by its own; tubes and the scene fade while apart.
//  * Slow turntable when idle (never with reduced motion), orbit / zoom / pan.
//  * ViewerApi (toPNG / toSharePNG) so "Share a picture" works as before.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";

import { buildPartModel } from "@/lib/studio/models";
import type { ProductUnlockResult } from "@/lib/studio/client/product";
import { buildSceneProps, sceneHintsFromPieces, setPropsOpacity } from "@/lib/studio/product/scene/props";
import {
  VIEW_DIRS,
  applyRendererLook,
  frameBox,
  geometryFromArrays,
  linkMaterial,
  makeEnvironment,
  makeLights,
  pictureBox,
  pieceMaterial,
  STAGE_LOOK,
} from "@/lib/studio/product/scene/stage";
import type { Finish, LibraryPart } from "@/lib/studio/schema";
import { cloneMaterials, disposeObject } from "./materials";
import { canvasToPNG, composeShareImage, SHARE_SIZE } from "./share-image";
import type { ViewerApi } from "./types";
import { usePrefersReducedMotion } from "./hooks";

export type ProductViewerProps = {
  product: ProductUnlockResult;
  getPart: (id: string) => LibraryPart | undefined;
  /** 0..1 */
  explode: number;
  /** Override the finish of the printed (non-clear) bodies; null = the design's own. */
  finish?: Finish | null;
  autoRotate?: boolean;
  ariaLabel?: string;
  onReady?(api: ViewerApi): void;
};

const TURNTABLE_RAD_S = 0.15;
const RESUME_MS = 4000;

type Scene3 = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  pieces: { mesh: THREE.Mesh; explode: [number, number, number]; look: Parameters<typeof pieceMaterial>[0] }[];
  parts: { obj: THREE.Object3D; rest: THREE.Vector3; explode: [number, number, number] }[];
  links: THREE.Mesh[];
  props: ReturnType<typeof buildSceneProps>;
  dispose(): void;
};

export default function ProductViewer({ product, getPart, explode, finish = null, autoRotate = true, ariaLabel, onReady }: ProductViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const s3 = useRef<Scene3 | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [ready, setReady] = useState(false);
  const target = useRef(explode);
  const current = useRef(explode);
  const lastInteraction = useRef(0);
  const lastChange = useRef(0);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const kick = useRef<() => void>(() => undefined);
  const spinRef = useRef(autoRotate && !reducedMotion);
  spinRef.current = autoRotate && !reducedMotion;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  // ── Build the scene once per product ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    applyRendererLook(renderer);
    const env = makeEnvironment(renderer);
    const scene = new THREE.Scene();
    scene.environment = env.texture;
    scene.environmentIntensity = STAGE_LOOK.envIntensity;
    const lights = makeLights();
    scene.add(lights.group);
    const root = new THREE.Group();
    scene.add(root);

    const props = buildSceneProps(product.scene, product.stage, product.bbox, sceneHintsFromPieces(product.pieces));
    root.add(props.group);
    const pieces: Scene3["pieces"] = [];
    for (const p of product.pieces) {
      if (!p.positions || !p.indices) continue;
      const geo = geometryFromArrays({ positions: p.positions, normals: p.normals, indices: p.indices });
      const mesh = new THREE.Mesh(geo, pieceMaterial(p, null));
      mesh.name = p.id;
      mesh.castShadow = p.material !== "resin_clear";
      mesh.receiveShadow = true;
      root.add(mesh);
      pieces.push({ mesh, explode: p.explode, look: p });
    }
    const links: THREE.Mesh[] = [];
    for (const l of product.links) {
      if (!l.positions || !l.indices) continue;
      const mesh = new THREE.Mesh(geometryFromArrays({ positions: l.positions, normals: l.normals, indices: l.indices }), linkMaterial(l.kind, l.colourHex));
      mesh.castShadow = true;
      root.add(mesh);
      links.push(mesh);
    }
    const parts: Scene3["parts"] = [];
    for (const e of product.electronics) {
      const part = getPart(e.partId);
      if (!part) continue;
      let obj: THREE.Group;
      try {
        obj = buildPartModel(part);
      } catch {
        continue;
      }
      cloneMaterials(obj);
      const m = e.matrix;
      const rot = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
      obj.quaternion.setFromRotationMatrix(rot);
      obj.position.set(...e.pos);
      obj.name = e.instanceId;
      root.add(obj);
      parts.push({ obj, rest: new THREE.Vector3(...e.pos), explode: e.explode });
    }

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    const markUser = () => {
      lastInteraction.current = performance.now();
      goal.current = null;
      kick.current();
    };
    controls.addEventListener("start", markUser);
    controls.addEventListener("change", () => {
      lastChange.current = performance.now();
      kick.current();
    });

    const box0 = pictureBox(product.bbox, props.focus);
    const sphere = box0.getBoundingSphere(new THREE.Sphere());
    lights.place(sphere.center, Math.max(30, sphere.radius));

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      kick.current();
    };
    resize();
    frameBox(camera, box0, VIEW_DIRS.iso, 0.8);
    controls.target.copy(box0.getCenter(new THREE.Vector3()));
    controls.minDistance = sphere.radius * 0.6;
    controls.maxDistance = sphere.radius * 8;
    controls.update();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    s3.current = {
      renderer,
      scene,
      camera,
      controls,
      root,
      pieces,
      parts,
      links,
      props,
      dispose() {
        ro.disconnect();
        controls.dispose();
        for (const p of pieces) {
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose();
        }
        for (const l of links) {
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
        for (const p of parts) disposeObject(p.obj);
        props.dispose();
        env.dispose();
        renderer.dispose();
      },
    };

    // ── Render loop: draws only while something moves (one loop at a time) ──
    let raf = 0;
    let last = performance.now();
    const frame = () => {
      raf = 0;
      const S = s3.current;
      if (!S) return;
      inFrame = true;
      const now = performance.now();
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      let moving = false;
      // Explode easing.
      const tgt = target.current;
      if (Math.abs(current.current - tgt) > 0.001) {
        current.current = reducedRef.current ? tgt : current.current + (tgt - current.current) * (1 - Math.exp(-8 * dt));
        if (Math.abs(current.current - tgt) <= 0.001) current.current = tgt;
        moving = true;
      }
      applyExplode(S, current.current);
      // Camera glide (after an explode change), unless the visitor took over.
      const g = goal.current;
      if (g) {
        const k = reducedRef.current ? 1 : 1 - Math.exp(-6 * dt);
        S.camera.position.lerp(g.pos, k);
        S.controls.target.lerp(g.target, k);
        if (S.camera.position.distanceTo(g.pos) < 0.1) goal.current = null;
        moving = true;
      }
      // Turntable when idle.
      const idle = performance.now() - lastInteraction.current > RESUME_MS;
      if (spinRef.current && idle && !document.hidden) {
        S.root.rotation.z += dt * TURNTABLE_RAD_S;
        moving = true;
      }
      S.controls.update();
      // Damping keeps easing for a moment after the last camera change.
      if (performance.now() - lastChange.current < 400) moving = true;
      S.renderer.render(S.scene, S.camera);
      inFrame = false;
      if ((moving || again) && !raf) raf = requestAnimationFrame(frame);
      again = false;
    };
    // A kick while a frame is being drawn (controls "change") asks for one more frame, never a second loop.
    let inFrame = false;
    let again = false;
    kick.current = () => {
      if (inFrame) {
        again = true;
        return;
      }
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    kick.current();
    setReady(true);
    const onVisible = () => kick.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (raf) cancelAnimationFrame(raf);
      kick.current = () => undefined;
      s3.current?.dispose();
      s3.current = null;
      setReady(false);
    };
  }, [product, getPart]);

  // ── Explode target + camera framing for the taken-apart view ───────────────
  useEffect(() => {
    target.current = Math.max(0, Math.min(1, explode));
    const S = s3.current;
    if (!S) return;
    // Frame where the parts are going (not where they are), unless the visitor is steering.
    let frame: THREE.Box3;
    if (target.current > 0.05) {
      // From the meshes' own boxes + the explode offsets (root frame; part models may hold helpers without bounds).
      frame = new THREE.Box3();
      const t = target.current;
      for (const p of S.pieces) {
        const bb = p.mesh.geometry.boundingBox;
        if (bb) frame.union(bb.clone().translate(new THREE.Vector3(p.explode[0] * t, p.explode[1] * t, p.explode[2] * t)));
      }
      for (const p of S.parts) frame.expandByPoint(p.rest.clone().add(new THREE.Vector3(p.explode[0] * t, p.explode[1] * t, p.explode[2] * t)));
      frame.expandByScalar(6);
    } else {
      frame = pictureBox(product.bbox, S.props.focus);
    }
    const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (performance.now() - lastInteraction.current > 1500 && !frame.isEmpty() && finite(frame.min) && finite(frame.max)) {
      const cam = new THREE.PerspectiveCamera(S.camera.fov, S.camera.aspect, 1, 20000);
      const dir = S.camera.position.clone().sub(S.controls.target).normalize();
      frameBox(cam, frame, [dir.x, dir.y, dir.z], 0.8);
      const centre = frame.getCenter(new THREE.Vector3());
      if (finite(cam.position) && finite(centre)) {
        goal.current = { pos: cam.position.clone(), target: centre };
        // The far plane must reach the new distance.
        S.camera.far = Math.max(S.camera.far, cam.far);
        S.camera.near = Math.min(S.camera.near, cam.near);
        S.camera.updateProjectionMatrix();
      }
    }
    kick.current();
  }, [explode, product.bbox]);

  // ── Finish override for the printed bodies ─────────────────────────────────
  useEffect(() => {
    const S = s3.current;
    if (!S) return;
    for (const p of S.pieces) {
      if (p.look.material === "resin_clear" || p.look.material === "aluminium" || p.look.material === "TPU") continue;
      const old = p.mesh.material as THREE.Material;
      p.mesh.material = pieceMaterial(p.look, finish);
      old.dispose();
    }
    kick.current();
  }, [finish, ready]);

  useEffect(() => {
    if (reducedMotion && s3.current) {
      s3.current.root.rotation.z = 0;
      kick.current();
    }
  }, [reducedMotion]);

  // ── ViewerApi ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !onReady) return;
    const api: ViewerApi = {
      getObjects() {
        return s3.current ? [...s3.current.pieces.map((p) => p.mesh), ...s3.current.parts.map((p) => p.obj)] : [];
      },
      toPNG() {
        const S = s3.current;
        if (!S) return Promise.reject(new Error("no viewer"));
        S.renderer.render(S.scene, S.camera);
        return new Promise<Blob>((resolve, reject) => {
          S.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("toPNG: canvas is empty"))), "image/png");
        });
      },
      toSharePNG(opts) {
        const S = s3.current;
        if (!S) return Promise.reject(new Error("no viewer"));
        const size = opts.size ?? SHARE_SIZE;
        const prevSize = S.renderer.getSize(new THREE.Vector2());
        const prevDpr = S.renderer.getPixelRatio();
        const prevAspect = S.camera.aspect;
        let out: HTMLCanvasElement;
        try {
          S.renderer.setPixelRatio(1);
          S.renderer.setSize(size, size, false);
          S.camera.aspect = 1;
          S.camera.updateProjectionMatrix();
          S.renderer.render(S.scene, S.camera);
          out = composeShareImage(S.renderer.domElement, { ...opts, size });
        } finally {
          S.renderer.setPixelRatio(prevDpr);
          S.renderer.setSize(prevSize.x, prevSize.y, false);
          S.camera.aspect = prevAspect;
          S.camera.updateProjectionMatrix();
          S.renderer.render(S.scene, S.camera);
        }
        return canvasToPNG(out);
      },
    };
    onReady(api);
  }, [ready, onReady]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)", touchAction: "none" }}
      role="img"
      aria-label={ariaLabel}
      data-viewer="product"
      data-ready={ready ? "1" : "0"}
      data-explode={explode > 0.01 ? "apart" : "together"}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function applyExplode(S: Scene3, t: number) {
  for (const p of S.pieces) p.mesh.position.set(p.explode[0] * t, p.explode[1] * t, p.explode[2] * t);
  for (const p of S.parts) p.obj.position.set(p.rest.x + p.explode[0] * t, p.rest.y + p.explode[1] * t, p.rest.z + p.explode[2] * t);
  const apart = t > 0.04;
  for (const l of S.links) l.visible = !apart;
  setPropsOpacity(S.props.group, 1 - Math.min(1, t * 1.6) * 0.8);
}
