"use client";

// A rotatable, zoomable preview of a binary STL (three.js + OrbitControls).
// Imported only through next/dynamic from the CAD card, so three.js stays
// out of the main bundle. Z is up (OpenSCAD's bed is the XY plane); the
// camera fits the part whenever a new STL arrives.

import { useEffect, useRef } from "react";
import {
  Box3,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const COBALT = 0x0e59c5;

export default function CadViewer({ stl, label }: { stl: ArrayBuffer; label?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0xc9d1dc, 1.6));
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(1, -1.5, 2);
    scene.add(key);
    const rim = new DirectionalLight(0xffffff, 0.5);
    rim.position.set(-1.5, 1, 0.5);
    scene.add(rim);

    const geometry = new STLLoader().parse(stl);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new Box3(new Vector3(), new Vector3(1, 1, 1));
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    // Centre on the bed, keep the bottom on z = 0.
    geometry.translate(-centre.x, -centre.y, -box.min.z);
    const material = new MeshStandardMaterial({ color: COBALT, roughness: 0.55, metalness: 0.05 });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const span = Math.max(size.x, size.y, size.z, 1);
    const grid = new GridHelper(Math.ceil((span * 1.6) / 10) * 10, 16, 0xb8c2d0, 0xd8dee6);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const camera = new PerspectiveCamera(35, 1, span / 100, span * 100);
    camera.up.set(0, 0, 1);
    const target = new Vector3(0, 0, size.z / 2);
    const radius = Math.max(size.length() / 2, 0.5);
    const view = new Vector3(0.9, -1.3, 0.85).normalize();
    /** Distance at which the bounding sphere fits the narrower field of view, with a margin. */
    const fit = (aspect: number) => {
      const half = (camera.fov * Math.PI) / 360;
      const narrow = aspect < 1 ? Math.atan(Math.tan(half) * aspect) : half;
      return (radius / Math.sin(narrow)) * 1.15;
    };
    camera.position.copy(target).add(view.clone().multiplyScalar(fit(2)));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.minDistance = span * 0.3;
    controls.maxDistance = span * 10;
    controls.update();

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    camera.position.copy(target).add(view.clone().multiplyScalar(fit(camera.aspect)));
    controls.update();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [stl]);

  return <div ref={host} role="img" aria-label={label} className="h-72 w-full cursor-grab active:cursor-grabbing sm:h-80" />;
}
