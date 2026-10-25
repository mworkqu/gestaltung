// What the template enclosure IS, as pure numbers: the dimensions, where the
// parts end up standing in it, every opening, and where the raised name goes.
//
// This is the whole template path except the mesh. It used to live in
// enclosure/build.ts next to the three-bvh-csg builder; the mesh is now built by
// the product kernel (manifold-3d, lib/studio/geometry/enclosure-kernel.ts), so
// the plan lives on its own and stays free of three.js — the UI, the tests and
// the worker all read the same numbers.

import type { EnclosureSpec, LayoutItem, LibraryPart } from "../schema";
import type { LayoutResult } from "../layout";
import { cutoutsFor, keyholeCutouts, leadCutouts, ventCutouts, type Cutout } from "./cutouts";
import { planLabel, type LabelPlan } from "./label";
import type { LabelSkipReason } from "./label-font";
import { enclosureDims, settleLayout, type EnclosureDims } from "./templates";

export type EnclosureMeta = {
  W: number;
  D: number;
  H: number;
  splitZ: number;
  dims: EnclosureDims;
  cutouts: Cutout[];
  vents: Cutout[];
  /** wall_plate: the two keyhole slots in the back. */
  keyholes: Cutout[];
  /** Where the raised label went (null when there is none or it was skipped). */
  label: LabelPlan | null;
  /** Why spec.label was not raised: Arabic ("script"), unsupported characters, too long, or no free space. */
  labelSkipped?: LabelSkipReason | "space";
  /** The layout the case was cut for: poke-through sensors lifted to the lid (render parts with THIS). */
  layout: LayoutItem[];
  triangles: number;
  ms: number;
};

/** The pure plan of one case: dims, where the parts stand in it, and the openings. */
export type EnclosurePlan = {
  dims: EnclosureDims;
  placed: LayoutItem[];
  cutouts: Cutout[];
  keyholes: Cutout[];
  label: { plan: LabelPlan | null; skipped?: LabelSkipReason | "space" };
  vents: Cutout[];
  /** What the case is built for (feet, label text). */
  spec: EnclosureSpec;
};

export function planEnclosure(spec: EnclosureSpec, layoutResult: LayoutResult, parts: Map<string, LibraryPart>): EnclosurePlan {
  const dims = enclosureDims(spec, layoutResult);
  const placed = settleLayout(layoutResult.layout, parts, dims);
  // F-005: ports of the parts inside, plus a cable gland for every part outside.
  const cutouts = [...cutoutsFor(placed, parts, dims), ...leadCutouts(placed, parts, dims)];
  const keyholes = keyholeCutouts(dims);
  const label = planLabel(spec.label, dims, [...cutouts, ...keyholes]);
  const vents = ventCutouts(spec, dims, [...cutouts, ...keyholes], label.plan ? [label.plan.box] : []);
  return { dims, placed, cutouts, keyholes, label, vents, spec };
}

/** The meta a built case reports (everything but the triangle count and the build time). */
export function metaOf(plan: EnclosurePlan): Omit<EnclosureMeta, "triangles" | "ms"> {
  const d = plan.dims;
  return {
    W: d.W,
    D: d.D,
    H: d.H,
    splitZ: d.splitZ,
    dims: d,
    cutouts: plan.cutouts,
    vents: plan.vents,
    keyholes: plan.keyholes,
    label: plan.label.plan,
    ...(plan.label.skipped ? { labelSkipped: plan.label.skipped } : {}),
    layout: plan.placed,
  };
}
