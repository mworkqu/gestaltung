// 3D wiring (P5-17e): the breadboard's 3D model (client only — draws a canvas).
//
// Cheap on purpose: ONE box (white body) whose top face carries a canvas
// texture with every hole (dark squares), the centre channel, the red (+) and
// blue (−) rail lines with their labels, row letters a–j and column numbers.
// 30 columns ≈ 1,000 px wide, 63 columns ≈ 2,000 px; no per-hole meshes.
// Frame = breadboard.ts (mm, Z up, centred, top face at z = spec.h). Nothing
// in it takes pointer hits (the view sets raycast off).

import * as THREE from "three";
import { allHoles, colX, isRailRow, rowY, ROW_LETTERS, type BreadboardSpec } from "./breadboard";

const BODY = "#f3f1ea";
const HOLE = "#2b2f36";
const HOLE_RIM = "#d9d5c9";
const RED = "#d93a2f";
const BLUE = "#2f6fd9";
const INK = "#8b909a";
const HOLE_MM = 1.15;

function drawTop(spec: BreadboardSpec): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const ppm = Math.min(12, 2048 / spec.w);
  const W = Math.round(spec.w * ppm);
  const H = Math.round(spec.d * ppm);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  const X = (x: number) => (x + spec.w / 2) * ppm;
  const Y = (y: number) => (spec.d / 2 - y) * ppm;
  g.fillStyle = BODY;
  g.fillRect(0, 0, W, H);

  // Centre channel and the grooves between the terminal strips and the rails.
  g.fillStyle = "#dcd8cc";
  g.fillRect(0, Y(1.9), W, 3.8 * ppm);
  g.fillStyle = "#c9c4b6";
  g.fillRect(0, Y(0.35), W, 0.7 * ppm);
  g.fillStyle = "#e6e2d7";
  for (const s of [1, -1]) g.fillRect(0, Y(s * 17.3 + 0.35), W, 0.7 * ppm);

  // Rail lines: red outside the + row, blue inside the − row, both sides.
  const line = (y: number, colour: string) => {
    g.fillStyle = colour;
    g.fillRect(X(-spec.w / 2 + 4.2), Y(y + 0.3), (spec.w - 8.4) * ppm, 0.6 * ppm);
  };
  line(-25.0, RED);
  line(-18.2, BLUE);
  line(25.0, RED);
  line(18.2, BLUE);

  // Holes.
  const s = HOLE_MM * ppm;
  for (const h of allHoles(spec.cols)) {
    const x = X(colX(spec.cols, h.col));
    const y = Y(rowY(h.row));
    g.fillStyle = HOLE_RIM;
    g.fillRect(x - s / 2 - ppm * 0.18, y - s / 2 - ppm * 0.18, s + ppm * 0.36, s + ppm * 0.36);
    g.fillStyle = HOLE;
    g.fillRect(x - s / 2, y - s / 2, s, s);
  }

  // Labels.
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = (t: string, x: number, y: number, size: number, colour: string, bold = false) => {
    g.font = `${bold ? "700" : "500"} ${Math.round(size * ppm)}px ui-sans-serif, system-ui, Arial, sans-serif`;
    g.fillStyle = colour;
    g.fillText(t, X(x), Y(y));
  };
  const edge = spec.w / 2 - 1.7;
  for (const sx of [-1, 1]) {
    for (let r = 0; r < 10; r++) text(ROW_LETTERS[r], sx * edge, rowY(r), 1.7, INK);
    for (const row of [10, 11, 12, 13]) {
      if (!isRailRow(row)) continue;
      const plus = row === 11 || row === 13;
      text(plus ? "+" : "−", sx * edge, rowY(row), 2.6, plus ? RED : BLUE, true);
    }
  }
  for (let col = 0; col < spec.cols; col++) {
    const n = col + 1;
    if (n !== 1 && n % 5 !== 0) continue;
    for (const sy of [-1, 1]) text(String(n), colX(spec.cols, col), sy * 15.9, 1.5, INK);
  }
  return c;
}

/** The breadboard as one textured box (origin = its centre on the mat, top face at z = spec.h). */
export function buildBreadboardModel(spec: BreadboardSpec): { group: THREE.Group; dispose: () => void } {
  const geo = new THREE.BoxGeometry(spec.w, spec.d, spec.h);
  const side = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.7, metalness: 0 });
  const canvas = drawTop(spec);
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  const top = new THREE.MeshStandardMaterial({ color: "#ffffff", map: tex, roughness: 0.72, metalness: 0 });
  const mesh = new THREE.Mesh(geo, [side, side, side, side, top, side]);
  mesh.position.z = spec.h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => undefined;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(spec.pos[0], spec.pos[1], 0);
  return {
    group,
    dispose: () => {
      geo.dispose();
      side.dispose();
      top.dispose();
      tex?.dispose();
    },
  };
}
