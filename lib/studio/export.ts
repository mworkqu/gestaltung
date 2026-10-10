// Studio file exports. STL has no unit field: every studio model is in
// millimetres, which is what slicers (PrusaSlicer, Cura…) assume by default.

import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

export type ExportedFile = { name: string; data: ArrayBuffer | string };

function ownMeshOnly(object: THREE.Object3D): THREE.Object3D {
  if (!(object instanceof THREE.Mesh)) return object;
  object.updateMatrixWorld(true);
  const m = new THREE.Mesh(object.geometry);
  m.applyMatrix4(object.matrixWorld);
  m.updateMatrixWorld(true);
  return m;
}

/**
 * STL of an object (and its children, unless `children: false`). Binary by
 * default (ArrayBuffer), ASCII string when binary = false. Units: mm.
 */
export function exportSTL(object: THREE.Object3D, binary = true, opts: { children?: boolean } = {}): ArrayBuffer | string {
  const target = opts.children === false ? ownMeshOnly(object) : object;
  target.updateMatrixWorld(true);
  const exporter = new STLExporter();
  if (binary) {
    const view = exporter.parse(target, { binary: true });
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  return exporter.parse(target, { binary: false });
}

const fileName = (o: THREE.Object3D, i: number) => `${(o.name || `part_${i + 1}`).replace(/[^\w-]+/g, "_")}.stl`;

/**
 * One STL per object. Children are left out by default: an enclosure's feet are
 * bought rubber pads, not printed parts.
 */
export function exportObjectsSTL(objects: THREE.Object3D[], opts: { binary?: boolean; children?: boolean } = {}): ExportedFile[] {
  return objects.map((o, i) => ({
    name: fileName(o, i),
    data: exportSTL(o, opts.binary ?? true, { children: opts.children ?? false }),
  }));
}

/**
 * A part ready for the slicer: its own mesh only (no children), turned as it
 * sits in the product but moved so it rests on z = 0 at the origin. Where the
 * viewer happens to have it (exploded or not) does not matter.
 */
function onBed(object: THREE.Object3D): THREE.Mesh | null {
  if (!(object instanceof THREE.Mesh)) return null;
  const geo = (object.geometry as THREE.BufferGeometry).clone();
  geo.applyQuaternion(object.quaternion);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
  geo.computeBoundingBox();
  return new THREE.Mesh(geo);
}

/** One printable part as a binary STL, resting on the bed (mm). */
export function printableSTL(object: THREE.Object3D): ArrayBuffer {
  const m = onBed(object);
  if (!m) return exportSTL(object, true, { children: false }) as ArrayBuffer;
  const out = exportSTL(m, true) as ArrayBuffer;
  m.geometry.dispose();
  return out;
}

/**
 * Every printable part laid out side by side on one bed (rows up to `bedWidth`
 * mm, `gap` mm apart) as ONE binary STL — open it in a slicer and print.
 */
export function plateSTL(objects: THREE.Object3D[], opts: { bedWidth?: number; gap?: number } = {}): ArrayBuffer {
  const bedWidth = opts.bedWidth ?? 240;
  const gap = opts.gap ?? 6;
  const group = new THREE.Group();
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  for (const o of objects) {
    const m = onBed(o);
    if (!m) continue;
    const b = m.geometry.boundingBox!;
    const w = b.max.x - b.min.x;
    const d = b.max.y - b.min.y;
    if (x > 0 && x + w > bedWidth) {
      x = 0;
      y += rowDepth + gap;
      rowDepth = 0;
    }
    m.position.set(x + w / 2, y + d / 2, 0);
    group.add(m);
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
  }
  const out = exportSTL(group, true) as ArrayBuffer;
  for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
  return out;
}

/** Save data as a file in the browser (no-op outside a browser). */
export function downloadBlob(name: string, data: BlobPart, mime = "application/octet-stream"): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** An SVG string as a Blob (schematic / wiring downloads). */
export function exportSVG(svgString: string): Blob {
  const text = svgString.trimStart().startsWith("<?xml") ? svgString : `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
  return new Blob([text], { type: "image/svg+xml" });
}
