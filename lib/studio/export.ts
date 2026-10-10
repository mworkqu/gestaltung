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
