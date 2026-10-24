// Studio file exports (three.js: load on demand). STL has no unit field: every studio model is in
// millimetres, which is what slicers (PrusaSlicer, Cura…) assume by default.

import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { MK4_BED, platePlan } from "./geometry/mesh-check";

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
 * Every printable part laid out on PRINTER BEDS, one binary STL per bed (F-003).
 *
 * The old single-plate writer only wrapped rows at a width and let the plate
 * grow in y without limit — the tester's plate came out 406 mm long, so it fitted
 * no printer. The layout rule now lives in geometry/mesh-check.ts platePlan()
 * and is shared with the product pipeline: parts are shelf-packed inside the
 * MK4 envelope (250 x 210 mm) and spill onto a second bed instead of growing.
 *
 * A part larger than the bed on its own is reported in `tooBig` and left off.
 */
export function platesSTL(
  objects: THREE.Object3D[],
  opts: { bed?: { x: number; y: number; z: number } } = {},
): { plates: { data: ArrayBuffer; w: number; d: number }[]; tooBig: number[] } {
  const meshes = objects.map((o) => onBed(o));
  const items = meshes.map((m) => {
    const b = m?.geometry.boundingBox;
    return b ? { w: b.max.x - b.min.x, d: b.max.y - b.min.y, h: b.max.z - b.min.z } : { w: 0, d: 0, h: 0 };
  });
  const plan = platePlan(items, opts.bed ?? MK4_BED);
  const plates = plan.plates.map((plate) => {
    const group = new THREE.Group();
    for (const it of plate.items) {
      const m = meshes[it.index];
      if (!m) continue;
      m.position.set(it.x, it.y, 0);
      group.add(m);
    }
    const data = exportSTL(group, true) as ArrayBuffer;
    group.clear();
    return { data, w: plate.w, d: plate.d };
  });
  for (const m of meshes) m?.geometry.dispose();
  return { plates, tooBig: plan.tooBig };
}

export { downloadBlob, exportSVG } from "./download";
