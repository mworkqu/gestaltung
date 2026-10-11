// "Every actuator / sensor in the parts list appears physically" (P5-16 spec,
// step 3) — enforced deterministically AFTER the AI, so a model answer can never
// drop the pump's reservoir, the soil probe's stake or the LED's light window.
//
// The rules themselves live in the Phase 1 solver (solve.ts ensureHomes: pump →
// reservoir + tube + nozzle, soil probe → stake + prongs, LED → clear light ring /
// window, button → cap; USB turned to a reachable face and checked). Here we only
// add what the solver does not decide on its own, then keep the solver's output
// model (the one with the added bodies) as THE model:
//   * a light ring / window the AI made in an opaque material becomes resin_clear
//     (light must come through it);
//   * a soil probe on a product whose head is NOT standing on the ground (a wall
//     or desk design picked by "Try another") gets its own stake in the soil and
//     a cable to the head — the solver only grows a stake under a grounded head.
// Pure + deterministic (tested).

import type { LayoutInput } from "../../layout";
import type { ProductSpec } from "../../schema";
import { needsOf } from "../archetypes";
import { formFrame } from "../forms/geometry";
import { clampBody, clampProductModel, type ProductModel } from "../schema";
import { solveProduct, type SolverIssue } from "../solve";

export type PhysicalResult = {
  model: ProductModel;
  /** Solver issues of the final model (Engineer view only). */
  issues: SolverIssue[];
  solvedHash: string;
};

/** Light parts need a clear body to shine through: opaque light rings / windows become clear resin. */
export function clearLightBodies(model: ProductModel, light: boolean): ProductModel {
  if (!light) return model;
  const out = structuredClone(model);
  for (const b of out.bodies) {
    if ((b.role === "light_ring" || b.role === "window") && b.material !== "resin_clear") {
      b.material = "resin_clear";
      b.colour = "mist";
      b.finish = "glossy_plastic";
    }
  }
  return out;
}

const grounded = (to: string) => to === "ground" || to === "scene";

/** A soil probe needs a stake in the soil even when the head hangs on a wall or sits on a desk. */
export function soilStakeFor(model: ProductModel, soil: boolean): ProductModel {
  if (!soil || model.bodies.some((b) => b.form.kind === "stake")) return model;
  const host = model.bodies.find((b) => b.id === model.electronicsHost);
  // A grounded head: the solver grows the stake under it. Room for stake + prongs: ≤ 6 bodies now.
  if (!host || grounded(host.attach.to) || model.bodies.length > 6) return model;
  const out = structuredClone(model);
  const ids = new Set(out.bodies.map((b) => b.id));
  let id = "probe_stake";
  for (let n = 2; ids.has(id); n++) id = `probe_stake_${n}`;
  const x = Math.round(formFrame(host.form).size[0] / 2 + 60);
  out.bodies.push(
    clampBody(
      {
        id,
        role: "stake",
        form: { kind: "stake", section: "blade", length: 120, width: 28, thick: 12, taper: 0.35 },
        attach: { to: "ground", anchor: "top", offset: [x, 0, -95] },
        material: "PETG",
        colour: host.colour,
        finish: "matte_plastic",
      },
      out.bodies.length,
    ),
  );
  if (out.links.length < 4) out.links.push({ kind: "cable", from: { body: id, anchor: "top" }, to: { body: host.id, anchor: "back" }, diameter: 4, colour: "graphite" });
  return out;
}

/**
 * The model as the client will see it: every part with a physical home (solver
 * homes), light through clear bodies, USB facing a reachable side. Never throws.
 */
export function ensurePhysical(input: unknown, parts: readonly LayoutInput[], spec: ProductSpec): PhysicalResult {
  const needs = needsOf(spec, parts);
  const model = soilStakeFor(clearLightBodies(clampProductModel(input), needs.light), needs.soil);
  const first = solveProduct(model, parts, { spec });
  // Bodies the solver added are in solved.model; re-clamp so it is exactly a stored model.
  const final = clearLightBodies(clampProductModel(first.model), needs.light);
  // Solve the stored model itself, so the hash is what the worker will build.
  const solved = solveProduct(final, parts, { spec });
  const added = first.issues.filter((i) => i.code === "body_added" || i.code === "link_added");
  return { model: final, issues: [...added, ...solved.issues], solvedHash: solved.hash };
}
