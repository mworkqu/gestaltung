// 3D wiring (P5-17h): one "silkscreen" decal per part with every pin's name.
//
// The boxes come from lib/studio/wiring3d/pin-labels.ts (model frame); the text
// is drawn ONCE into a CanvasTexture and laid flat a hair above the part's
// surface (one plane per part, no mesh per pin). A pin that a wire uses gets a
// small pill in that wire's colour behind its name, so wire ↔ pin match by
// colour and name; unused pins stay plain (light on dark boards, dark on the
// mat). The view fades the decal in by zoom (fadeFor) so names only show when
// they are big enough to read. Loaded only inside the lazy 3D chunk.

import * as THREE from "three";

import type { PinLabelLayout } from "@/lib/studio/wiring3d/pin-labels";

/** Canvas pixels per mm (capped by MAX_PX per side). */
const PX_PER_MM = 30;
const MAX_PX = 2048;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Text that reads on a pill of this colour. */
function inkOn(hex: string): string {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 0.45 ? "#111827" : "#ffffff";
}

export type PinDecal = { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; dispose: () => void };

/** `used`: pin id → wire colour (hex) for pins a wire lands on. */
export function buildPinDecal(layout: PinLabelLayout, used: Map<string, string>): PinDecal | null {
  if (!layout.labels.length) return null;
  const b = layout.bounds;
  const pad = 0.4;
  const wmm = b.x1 - b.x0 + pad * 2;
  const hmm = b.y1 - b.y0 + pad * 2;
  const s = Math.min(PX_PER_MM, MAX_PX / Math.max(wmm, hmm));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(4, Math.ceil(wmm * s));
  canvas.height = Math.max(4, Math.ceil(hmm * s));
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of layout.labels) {
    const cx = ((l.box.x0 + l.box.x1) / 2 - b.x0 + pad) * s;
    const cy = (b.y1 + pad - (l.box.y0 + l.box.y1) / 2) * s;
    const long = Math.max(l.box.x1 - l.box.x0, l.box.y1 - l.box.y0) * s;
    const short = Math.min(l.box.x1 - l.box.x0, l.box.y1 - l.box.y0) * s;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-l.angle * Math.PI) / 180);
    const wire = used.get(l.pin);
    if (wire) {
      ctx.fillStyle = wire;
      const r = short / 2;
      ctx.beginPath();
      ctx.roundRect(-long / 2, -short / 2, long, short, r);
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.strokeStyle = l.onDark ? "rgba(255,255,255,0.85)" : "rgba(17,24,39,0.55)";
      ctx.stroke();
      ctx.fillStyle = inkOn(wire);
    } else {
      ctx.fillStyle = l.onDark ? "rgba(255,255,255,0.92)" : "rgba(28,36,52,0.88)";
    }
    ctx.font = `700 ${Math.round(l.size * s)}px ${FONT}`;
    ctx.fillText(l.text, 0, short * 0.04, long * 0.96);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  const geo = new THREE.PlaneGeometry(wmm, hmm);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, layout.z + 0.06);
  mesh.raycast = () => undefined;
  mesh.renderOrder = 2;
  mesh.visible = false;
  mesh.name = "pin_labels";
  return {
    mesh,
    material,
    dispose: () => {
      geo.dispose();
      material.dispose();
      tex.dispose();
    },
  };
}

/** Opacity for text of `sizeMm` at `dist` (world mm) in a view `heightPx` tall: 0 under ~7 px, 1 from ~10 px. */
export function fadeFor(sizeMm: number, dist: number, fovDeg: number, heightPx: number): number {
  const pxPerMm = heightPx / (2 * Math.max(1e-3, dist) * Math.tan((fovDeg * Math.PI) / 360));
  const px = sizeMm * pxPerMm;
  return Math.max(0, Math.min(1, (px - 7) / 3));
}
