// validatePart(): every problem with a library part, as plain strings (empty = good).

import * as THREE from "three";
import { LibraryPartSchema, type LibraryPart, type Face } from "../schema";
import { BUILDERS, buildPartModel } from "../models";

/** Width (u) and height (v) of a face of the part's bounding box. */
export function faceSize(dims: LibraryPart["dims"], face: Face): { w: number; h: number } {
  if (face === "+x" || face === "-x") return { w: dims.y, h: dims.z };
  if (face === "+y" || face === "-y") return { w: dims.x, h: dims.z };
  return { w: dims.x, h: dims.y };
}

const BBOX_TOLERANCE = 0.1;

/**
 * `skipModelCheck`: skip building the model and its bounding-box checks (STL
 * parts uploaded by the owner — the viewer scales/centres the mesh to dims).
 */
export function validatePart(part: LibraryPart, opts: { skipModelCheck?: boolean } = {}): string[] {
  const errors: string[] = [];
  const tag = `${part.id}:`;

  const parsed = LibraryPartSchema.safeParse(part);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${tag} schema ${issue.path.join(".")}: ${issue.message}`);
  }

  const seen = new Set<string>();
  for (const pin of part.pins) {
    if (seen.has(pin.id)) errors.push(`${tag} duplicate pin id "${pin.id}"`);
    seen.add(pin.id);
  }

  const { dims } = part;
  for (const [i, port] of part.ports.entries()) {
    const f = faceSize(dims, port.face);
    const uc = port.at.u * f.w;
    const vc = port.at.v * f.h;
    if (port.size.w > f.w || port.size.h > f.h) {
      errors.push(`${tag} port ${i + 1} (${port.kind}) is bigger than the ${port.face} face (${f.w} x ${f.h})`);
    } else if (uc - port.size.w / 2 < -1e-6 || uc + port.size.w / 2 > f.w + 1e-6 ||
               vc - port.size.h / 2 < -1e-6 || vc + port.size.h / 2 > f.h + 1e-6) {
      errors.push(`${tag} port ${i + 1} (${port.kind}) sticks out of the ${port.face} face`);
    }
  }

  for (const [i, h] of (part.mount?.holes ?? []).entries()) {
    if (Math.abs(h.x) + h.d / 2 > dims.x / 2 + 1e-6 || Math.abs(h.y) + h.d / 2 > dims.y / 2 + 1e-6) {
      errors.push(`${tag} mount hole ${i + 1} is outside the footprint`);
    }
  }

  if (opts.skipModelCheck) return errors;

  if (part.model.kind === "procedural" && !BUILDERS[part.model.builder]) {
    errors.push(`${tag} builder "${part.model.builder}" is not registered`);
    return errors;
  }

  try {
    const group = buildPartModel(part);
    group.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(group);
    const size = b.getSize(new THREE.Vector3());
    for (const axis of ["x", "y", "z"] as const) {
      const want = dims[axis];
      if (Math.abs(size[axis] - want) > want * BBOX_TOLERANCE) {
        errors.push(`${tag} model ${axis}-size ${size[axis].toFixed(2)} is not within 10% of ${want}`);
      }
    }
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    if (Math.abs(cx) > dims.x * 0.05 || Math.abs(cy) > dims.y * 0.05) errors.push(`${tag} model is not centred in x/y`);
    if (Math.abs(b.min.z) > Math.max(0.2, dims.z * 0.05)) errors.push(`${tag} model does not sit on z = 0 (min z ${b.min.z.toFixed(2)})`);
  } catch (e) {
    errors.push(`${tag} model failed to build: ${e instanceof Error ? e.message : String(e)}`);
  }
  return errors;
}
