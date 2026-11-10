"use client";

// Landing hero 3D assembly: a gear pair on two shafts in front of an L
// bracket, slowly turning. Loaded ONLY through next/dynamic (ssr: false) from
// hero-visual.tsx, so three.js + R3F never reach the first load. Uses the
// Studio's LeanCanvas (only the three.js classes it registers are bundled);
// everything in the scene is built imperatively and shown via <primitive>,
// so no new JSX element has to be registered. `running` false = frameloop
// "never" (off-screen / tab hidden): nothing renders, nothing burns battery.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  type BufferGeometry,
  type Material,
} from "three";

import { LeanCanvas } from "@/components/studio/viewer/LeanCanvas";
import { centreDistance, gearDims, gearOutline, HERO_GEARS, meshPhase, type GearSpec } from "@/lib/cad-champions/landing/gear";

const SPEED = 0.35; // driver rad/s: slow, calm
const GEAR_DEPTH = 0.45;

function gearGeometry(g: GearSpec, phase: number, bore: number): ExtrudeGeometry {
  const pts = gearOutline(g, phase);
  const shape = new Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const hole = new Path();
  hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new ExtrudeGeometry(shape, {
    depth: GEAR_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 24,
  });
  geo.translate(0, 0, -GEAR_DEPTH / 2);
  return geo;
}

type Built = {
  root: Group;
  driver: Mesh;
  driven: Mesh;
  ratio: number;
  dispose: () => void;
};

function buildAssembly(): Built {
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const geo = <T extends BufferGeometry>(g: T) => (geos.push(g), g);
  const mat = (m: MeshStandardMaterial) => (mats.push(m), m);

  const cobalt = mat(new MeshStandardMaterial({ color: "#1d6ae0", metalness: 0.35, roughness: 0.38 }));
  const steel = mat(new MeshStandardMaterial({ color: "#aab6c6", metalness: 0.75, roughness: 0.32 }));
  const dark = mat(new MeshStandardMaterial({ color: "#2a3346", metalness: 0.6, roughness: 0.4 }));
  const plate = mat(new MeshStandardMaterial({ color: "#d5dde8", metalness: 0.2, roughness: 0.6 }));

  const { driver: g1, driven: g2 } = HERO_GEARS;
  const dist = centreDistance(g1, g2);
  const root = new Group();
  // Centre the pair horizontally.
  const x1 = -dist / 2 + 0.35;
  const x2 = x1 + dist;

  const driver = new Mesh(geo(gearGeometry(g1, 0, 0.26)), cobalt);
  driver.position.set(x1, 0, 0);
  const driven = new Mesh(geo(gearGeometry(g2, meshPhase(g2), 0.2)), steel);
  driven.position.set(x2, 0, 0);

  // Shafts (cylinders run along Y by default; turn them onto Z).
  const shaft1 = new Mesh(geo(new CylinderGeometry(0.26, 0.26, 2.4, 32)), dark);
  shaft1.rotation.x = Math.PI / 2;
  shaft1.position.set(x1, 0, -0.75);
  const shaft2 = new Mesh(geo(new CylinderGeometry(0.2, 0.2, 2.2, 32)), dark);
  shaft2.rotation.x = Math.PI / 2;
  shaft2.position.set(x2, 0, -0.7);

  // Hub collars.
  const hub1 = new Mesh(geo(new CylinderGeometry(0.42, 0.42, 0.3, 32)), dark);
  hub1.rotation.x = Math.PI / 2;
  hub1.position.set(x1, 0, GEAR_DEPTH / 2 + 0.15);
  const hub2 = new Mesh(geo(new CylinderGeometry(0.32, 0.32, 0.26, 32)), dark);
  hub2.rotation.x = Math.PI / 2;
  hub2.position.set(x2, 0, GEAR_DEPTH / 2 + 0.13);

  // L bracket behind the gears.
  const d1 = gearDims(g1);
  const back = new Mesh(geo(new BoxGeometry(dist + d1.outer + 1.6, d1.outer * 2 + 0.6, 0.18)), plate);
  back.position.set((x1 + x2) / 2, 0.1, -1.9);
  const foot = new Mesh(geo(new BoxGeometry(dist + d1.outer + 1.6, 0.18, 1.6)), plate);
  foot.position.set((x1 + x2) / 2, -d1.outer - 0.2, -1.2);

  root.add(back, foot, shaft1, shaft2, driver, driven, hub1, hub2);

  const hemi = new HemisphereLight("#ffffff", "#c4cfdd", 1.1);
  const key = new DirectionalLight("#ffffff", 2.2);
  key.position.set(4, 5, 6);
  const rim = new DirectionalLight("#bcd4ff", 0.9);
  rim.position.set(-5, 2, -3);
  const amb = new AmbientLight("#ffffff", 0.25);
  root.add(hemi, key, rim, amb);

  root.rotation.set(-0.35, 0.55, 0);

  return {
    root,
    driver,
    driven,
    ratio: g1.teeth / g2.teeth,
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

function Assembly() {
  const built = useMemo(buildAssembly, []);
  const t0 = useRef(0);
  useEffect(() => {
    return built.dispose;
  }, [built]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1); // no jump after a pause
    t0.current += dt;
    built.driver.rotation.z += SPEED * dt;
    built.driven.rotation.z -= SPEED * built.ratio * dt;
    // Gentle sway so the 3D form reads.
    built.root.rotation.y = 0.55 + Math.sin(t0.current * 0.25) * 0.35;
  });
  return <primitive object={built.root} />;
}

export default function HeroScene({ running, onReady }: { running: boolean; onReady?: () => void }) {
  return (
    <LeanCanvas
      frameloop={running ? "always" : "never"}
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.4, 9.5], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={() => onReady?.()}
      className="h-full w-full"
    >
      <Assembly />
    </LeanCanvas>
  );
}
