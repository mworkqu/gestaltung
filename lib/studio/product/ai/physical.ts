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
import type { Colour, ProductSpec } from "../../schema";
import { needsOf } from "../archetypes";
import { formFrame } from "../forms/geometry";
import { ARCHETYPE_SCENE, clampBody, clampProductModel, type Archetype, type ProductModel } from "../schema";
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

/**
 * The product must read as a designed object in its scene, not melt into it: in a
 * plant pot nothing the client sees is leaf-green (sage) — those bodies become warm
 * white — and in a pet's corner nothing is the floor's grey. Opaque bodies only
 * (clear light parts keep their glow colour).
 */
const SCENE_CLASH: Partial<Record<ProductModel["scene"], { colour: Colour; to: Colour }[]>> = {
  plant_pot: [{ colour: "sage", to: "chalk" }],
};

export function contrastWithScene(model: ProductModel): ProductModel {
  const rules = SCENE_CLASH[model.scene];
  if (!rules || !model.bodies.some((b) => b.material !== "resin_clear" && rules.some((r) => r.colour === b.colour))) return model;
  const out = structuredClone(model);
  for (const b of out.bodies) {
    if (b.material === "resin_clear") continue;
    const r = rules.find((x) => x.colour === b.colour);
    if (r) b.colour = r.to;
  }
  return out;
}

/**
 * Archetypes whose scene IS part of what makes them readable keep it: a feeder by the
 * food (kibble in the hopper and the bowl), a stake in a plant pot, a doorbell on the
 * wall. The designer moved the feeder onto a desk in a real run (score 5–6).
 */
const FIXED_SCENE: readonly Archetype[] = ["stake_device", "planter_insert", "pet_feeder", "wall_mount"];

export function archetypeScene(model: ProductModel): ProductModel {
  if (!FIXED_SCENE.includes(model.archetype)) return model;
  const scene = ARCHETYPE_SCENE[model.archetype];
  return model.scene === scene ? model : { ...model, scene };
}

/** Aluminium is bought (probe pins); a printed body asked for in aluminium becomes PLA with a metal-look finish. */
export function printableMaterials(model: ProductModel): ProductModel {
  if (!model.bodies.some((b) => b.material === "aluminium" && b.form.kind !== "prongs")) return model;
  const out = structuredClone(model);
  for (const b of out.bodies) {
    if (b.material !== "aluminium" || b.form.kind === "prongs") continue;
    b.material = "PLA";
    b.finish = "anodized_aluminium";
  }
  return out;
}

const isWallTurn = (r: readonly number[] | undefined) => !!r && Math.abs(r[0] - 90) < 1 && Math.abs(r[1]) < 1 && Math.abs(r[2]) < 1;

/**
 * Wall products: the root plate is turned up against the wall (rotate [90, 0, 0]) and
 * every layer on it faces out of the wall. The designer often attaches the next layer
 * to the plate's "front" without turning it, which builds a shelf sticking out of the
 * wall; that is re-read as what it meant: on the face pointing at the viewer (the
 * turned parent's "top"), turned the same way.
 */
export function wallFacing(model: ProductModel): ProductModel {
  if (model.scene !== "wall") return model;
  const out = structuredClone(model);
  let changed = false;
  for (let pass = 0; pass < 8; pass++) {
    let any = false;
    const byId = new Map(out.bodies.map((b) => [b.id, b]));
    for (const b of out.bodies) {
      const parent = byId.get(b.attach.to);
      if (!parent || !isWallTurn(parent.attach.rotate) || b.attach.rotate) continue;
      if (b.attach.anchor !== "front" && b.attach.anchor !== "top") continue;
      const o = b.attach.offset;
      // On the front face the offset slides along x and z; on the turned top along x and y (= world up).
      if (b.attach.anchor === "front") b.attach = { ...b.attach, anchor: "top", offset: [o[0], o[2], 0] };
      b.attach = { ...b.attach, rotate: [90, 0, 0] };
      any = true;
    }
    if (!any) break;
    changed = true;
  }
  return changed ? out : model;
}

/**
 * What makes some archetypes recognisable must survive the designer: a pet feeder
 * keeps a bowl on the floor in front of it and a chute over the bowl. Missing ones
 * come back, placed from the solved boxes of the AI's own bodies.
 */
export function signatureBodies(model: ProductModel, solved: { bodies: { id: string; box: { min: number[]; max: number[] } }[] }): ProductModel {
  if (model.archetype !== "pet_feeder") return model;
  const host = model.bodies.find((b) => b.id === model.electronicsHost);
  const hostBox = solved.bodies.find((b) => b.id === host?.id)?.box;
  if (!host || !hostBox) return model;
  const isBowl = (b: ProductModel["bodies"][number]) => b.shell === "open_top" && grounded(b.attach.to) && b.id !== host.id;
  // A low lathed dish on the floor IS the bowl, even when the designer forgot it is open.
  const dish = model.bodies.find((b) => b.id !== host.id && grounded(b.attach.to) && b.form.kind === "lathe_profile" && b.shell !== "open_top" && formFrame(b.form).size[2] < 60);
  if (!model.bodies.some(isBowl) && dish) {
    const fixed = structuredClone(model);
    fixed.bodies.find((b) => b.id === dish.id)!.shell = "open_top";
    return fixed;
  }
  // Room on the base in front of the hopper for the button, and height for the chute.
  const res = model.bodies.find((b) => b.role === "reservoir" && b.attach.to === host.id && b.attach.anchor === "top");
  if (res && host.form.kind === "rounded_extrude") {
    const resD = formFrame(res.form).size[1];
    const needD = Math.min(200, Math.round(resD + 44));
    if (host.form.d < needD - 0.5 || host.form.h < 59.5) {
      const fixed = structuredClone(model);
      const h = fixed.bodies.find((b) => b.id === host.id)!;
      if (h.form.kind === "rounded_extrude") h.form = { ...h.form, d: Math.max(h.form.d, needD), h: Math.max(h.form.h, 60) };
      const r = fixed.bodies.find((b) => b.id === res.id)!;
      const d = h.form.kind === "rounded_extrude" ? h.form.d : needD;
      r.attach = { ...r.attach, offset: [r.attach.offset[0], Math.round(Math.max(0, (d - resD) / 2 - 4)), 0] };
      return fixed;
    }
  }
  // The bowl stands right in front of the feeder: never inside it, never away from it.
  const bowlNow = model.bodies.find(isBowl);
  const bowlBox = bowlNow && solved.bodies.find((b) => b.id === bowlNow.id)?.box;
  const inside = !!bowlBox && bowlBox.max[1] > hostBox.min[1] - 1 && bowlBox.min[1] < hostBox.max[1];
  const away = !!bowlBox && !inside && hostBox.min[1] - bowlBox.max[1] > 12;
  if (bowlNow && bowlBox && (inside || away)) {
    const fixed = structuredClone(model);
    const w = fixed.bodies.find((b) => b.id === bowlNow.id)!;
    const half = (bowlBox.max[1] - bowlBox.min[1]) / 2;
    w.attach = { ...w.attach, offset: [w.attach.offset[0], Math.round(hostBox.min[1] - half - 2), 0] };
    return fixed;
  }
  const hasBowl = model.bodies.some(isBowl);
  const hasChute = model.bodies.some((b) => b.role === "nozzle");
  if (hasBowl && hasChute) return fitChuteOverBowl(model, solved, isBowl);
  if (model.bodies.length >= 8) return model;
  const out = structuredClone(model);
  const ids = new Set(out.bodies.map((b) => b.id));
  const fresh = (base: string) => {
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}_${n}`;
    ids.add(id);
    return id;
  };
  const accent = out.bodies.find((b) => b.role === "button_cap" || b.role === "lid")?.colour ?? (host.colour === "coral" ? "ocean" : "coral");
  const bowlR = 58;
  const cx = Math.round((hostBox.min[0] + hostBox.max[0]) / 2);
  if (!hasBowl && out.bodies.length < 8) {
    out.bodies.push(
      clampBody(
        {
          id: fresh("bowl"),
          role: "base",
          form: { kind: "lathe_profile", points: [[44, 0], [50, 4], [56, 20], [bowlR, 28]], round: 3, segments: 96 },
          attach: { to: "ground", anchor: "top", offset: [cx, Math.round(hostBox.min[1] - bowlR - 2), 0] },
          material: "PETG",
          colour: accent,
          finish: "glossy_plastic",
          shell: "open_top",
        },
        out.bodies.length,
      ),
    );
  }
  if (!hasChute && out.bodies.length < 8) {
    const h = hostBox.max[2] - hostBox.min[2];
    out.bodies.push(
      clampBody(
        {
          id: fresh("chute"),
          role: "nozzle",
          form: { kind: "nozzle", length: 40, d: 14, bore: 5, angle: 70, drop: 18 },
          attach: { to: host.id, anchor: "front", offset: [0, 0, Math.round(Math.max(0, h / 2 - 14))] },
          material: "PLA",
          colour: accent,
          finish: "matte_plastic",
        },
        out.bodies.length,
      ),
    );
  }
  return out;
}

/**
 * The chute must end ABOVE the bowl (not inside it, not under the floor): lift it up the
 * front of the feeder as far as there is room, then make the bowl shallower if needed.
 */
function fitChuteOverBowl(
  model: ProductModel,
  solved: { bodies: { id: string; box: { min: number[]; max: number[] } }[] },
  isBowl: (b: ProductModel["bodies"][number]) => boolean,
): ProductModel {
  const boxOf = (id: string) => solved.bodies.find((b) => b.id === id)?.box;
  const chute = model.bodies.find((b) => b.role === "nozzle");
  const bowl = model.bodies.find(isBowl);
  const parentBox = chute ? boxOf(chute.attach.to) : undefined;
  const cb = chute && boxOf(chute.id);
  const bb = bowl && boxOf(bowl.id);
  if (!chute || !bowl || !cb || !bb || !parentBox || chute.attach.anchor !== "front") return model;
  const overXY = Math.min(cb.max[0], bb.max[0]) > Math.max(cb.min[0], bb.min[0]) && Math.min(cb.max[1], bb.max[1]) > Math.max(cb.min[1], bb.min[1]);
  const need = (overXY ? bb.max[2] : 0) + 2 - cb.min[2];
  if (need <= 0) return model;
  const out = structuredClone(model);
  const c = out.bodies.find((b) => b.id === chute.id)!;
  const up = Math.max(0, Math.min(need, parentBox.max[2] - cb.max[2] - 1));
  const o = c.attach.offset;
  c.attach = { ...c.attach, offset: [o[0], o[1], Math.round((o[2] + up) * 10) / 10] };
  const left = need - up;
  const w = out.bodies.find((b) => b.id === bowl.id)!;
  if (left > 0 && overXY && w.form.kind === "lathe_profile") {
    const top = bb.max[2] - bb.min[2];
    const k = Math.max(12, top - left) / top;
    w.form = { ...w.form, points: w.form.points.map(([r, z]) => [r, Math.round(z * k * 10) / 10] as [number, number]) };
  }
  return out;
}

/**
 * No light part, no glow: a light ring or window the designer added to a product
 * without an LED would promise a light that is not there (a real run put a glowing
 * halo round a cat feeder's hopper). Leaf bodies only (nothing attaches to them).
 */
export function dropDeadLights(model: ProductModel, light: boolean): ProductModel {
  if (light) return model;
  const dead = model.bodies.filter((b) => (b.role === "light_ring" || b.role === "window") && !model.bodies.some((c) => c.attach.to === b.id) && b.id !== model.electronicsHost);
  if (!dead.length || model.bodies.length - dead.length < 2) return model;
  const gone = new Set(dead.map((b) => b.id));
  return { ...model, bodies: model.bodies.filter((b) => !gone.has(b.id)), links: model.links.filter((l) => !gone.has(l.from.body) && !gone.has(l.to.body)) };
}

/**
 * A window is a lens set INTO a face, not a block on it: at most 3 mm proud and at most
 * 70 % of the face it sits on (a real run made a TV remote's IR window 60 × 30 mm,
 * hanging off the end of the remote, and scored 3–5).
 */
export function lensSize(model: ProductModel): ProductModel {
  const byId = new Map(model.bodies.map((b) => [b.id, b]));
  const fix: { id: string; w: number; d: number; h: number }[] = [];
  for (const b of model.bodies) {
    if (b.role !== "window" || b.form.kind !== "rounded_extrude") continue;
    const parent = byId.get(b.attach.to);
    if (!parent) continue;
    const [pw, pd, ph] = formFrame(parent.form).size;
    const a = b.attach.anchor;
    const [faceW, faceH] = a === "top" || a === "bottom" ? [pw, pd] : a === "front" || a === "back" ? [pw, ph] : [pd, ph];
    // Turned 90° about x onto a side face, the form's d runs up the face.
    const w = Math.min(b.form.w, Math.max(8, faceW * 0.7));
    const d = Math.min(b.form.d, Math.max(8, faceH * 0.7));
    const h = Math.min(b.form.h, 3);
    if (w < b.form.w - 0.01 || d < b.form.d - 0.01 || h < b.form.h - 0.01) fix.push({ id: b.id, w, d, h });
  }
  if (!fix.length) return model;
  const out = structuredClone(model);
  for (const f of fix) {
    const b = out.bodies.find((x) => x.id === f.id)!;
    if (b.form.kind !== "rounded_extrude") continue;
    const r = Math.min(b.form.r, Math.min(f.w, f.d) / 2 - 0.01);
    b.form = { ...b.form, w: Math.round(f.w * 10) / 10, d: Math.round(f.d * 10) / 10, h: f.h, r: Math.max(1, Math.round(r * 100) / 100), fillet: Math.min(b.form.fillet, Math.max(1, f.h / 2)) };
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
 * homes), light through clear bodies, USB facing a reachable side, colours that
 * stand out from the scene, printable materials, wall layers facing out, and the
 * archetype's signature bodies. Never throws.
 */
export function ensurePhysical(input: unknown, parts: readonly LayoutInput[], spec: ProductSpec): PhysicalResult {
  const needs = needsOf(spec, parts);
  let model = lensSize(contrastWithScene(wallFacing(printableMaterials(archetypeScene(soilStakeFor(clearLightBodies(dropDeadLights(clampProductModel(input), needs.light), needs.light), needs.soil))))));
  // Feeder: bowl + chute back (placed from the solved boxes), then the chute lifted over the bowl.
  for (let i = 0; i < 5 && model.archetype === "pet_feeder"; i++) {
    const next = clampProductModel(signatureBodies(model, solveProduct(model, parts, { spec })));
    if (next === model || JSON.stringify(next) === JSON.stringify(model)) break;
    model = next;
  }
  const first = solveProduct(model, parts, { spec });
  // Bodies the solver added are in solved.model; re-clamp so it is exactly a stored model.
  const final = clearLightBodies(clampProductModel(first.model), needs.light);
  // Solve the stored model itself, so the hash is what the worker will build.
  const solved = solveProduct(final, parts, { spec });
  const added = first.issues.filter((i) => i.code === "body_added" || i.code === "link_added");
  return { model: final, issues: [...added, ...solved.issues], solvedHash: solved.hash };
}
