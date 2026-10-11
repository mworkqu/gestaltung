// P5-16d: the deterministic rules that keep a REAL designer answer recognisable
// (found by running the five ideas against Gemini): scene contrast, printable
// materials, wall layers facing out, the feeder's bowl + chute, and the default's
// bodies kept. Each case below is shaped like an answer the model actually gave.

import { describe, expect, it } from "vitest";
import { archetypeDefault } from "../archetypes";
import { GOLDEN_IDEAS, goldenParts } from "../__fixtures__/golden";
import { clampProductModel, type ProductModel } from "../schema";
import { solveProduct } from "../solve";
import { restoreDefaultBodies, validateDesigns } from "./design";
import { contrastWithScene, ensurePhysical, printableMaterials, wallFacing } from "./physical";

const golden = (key: string) => {
  const g = GOLDEN_IDEAS.find((x) => x.key === key)!;
  return { ...g, parts: goldenParts(g) };
};
const errorsOf = (m: ProductModel, key: string) => {
  const g = golden(key);
  return solveProduct(m, g.parts, { spec: g.spec }).issues.filter((i) => i.severity === "error");
};

describe("scene contrast", () => {
  it("a plant product is never leaf-green (clear light parts keep their colour)", () => {
    const g = golden("plant_waterer");
    const m = structuredClone(archetypeDefault("stake_device", g.spec, g.parts));
    for (const b of m.bodies) if (b.role === "housing" || b.role === "lid") b.colour = "sage";
    const out = contrastWithScene(m);
    expect(out.bodies.filter((b) => b.colour === "sage")).toEqual([]);
    expect(ensurePhysical(m, g.parts, g.spec).model.bodies.some((b) => b.colour === "sage" && b.material !== "resin_clear")).toBe(false);
    // Other scenes are left alone.
    const desk = { ...m, scene: "desk" as const };
    expect(contrastWithScene(desk)).toBe(desk);
  });
});

describe("printable materials", () => {
  it("aluminium stays on the probe pins only; a printed lamp stem asked in aluminium becomes PLA with a metal look", () => {
    const g = golden("desk_lamp");
    const m = structuredClone(archetypeDefault("lamp", g.spec, g.parts));
    for (const b of m.bodies) if (b.id === "stem" || b.id === "base") b.material = "aluminium";
    const out = printableMaterials(m);
    expect(out.bodies.filter((b) => b.material === "aluminium")).toEqual([]);
    expect(out.bodies.find((b) => b.id === "stem")!.finish).toBe("anodized_aluminium");
    const pw = golden("plant_waterer");
    const stake = archetypeDefault("stake_device", pw.spec, pw.parts);
    expect(printableMaterials(stake)).toBe(stake);
  });
});

describe("wall products face out of the wall", () => {
  it("a layer put on the turned plate's front (a shelf) is re-read as its face towards the viewer", () => {
    // What the model answered for the doorbell: housing on the plate's "front", button and halo unturned.
    const answer = clampProductModel({
      archetype: "wall_mount",
      scene: "wall",
      rationale: "",
      electronicsHost: "housing",
      links: [],
      bodies: [
        { id: "plate", role: "bracket", form: { kind: "rounded_extrude", shape: "rrect", w: 70, d: 60, h: 30, r: 10, fillet: 3 }, attach: { to: "scene", anchor: "back", offset: [0, 0, 0], rotate: [90, 0, 0] }, material: "PLA", colour: "graphite", finish: "matte_plastic" },
        { id: "housing", role: "housing", form: { kind: "enclosure", template: "wall_plate", w: 110, d: 75, h: 32, r: 8, fillet: 2 }, attach: { to: "plate", anchor: "front", offset: [0, 0, 0] }, material: "PLA", colour: "sand", finish: "soft_touch" },
        { id: "button", role: "button_cap", form: { kind: "button_cap", d: 26, h: 4, dome: 0.5, stem: 0 }, attach: { to: "housing", anchor: "top", offset: [0, 20, 0] }, material: "PLA", colour: "graphite", finish: "soft_touch" },
        { id: "halo", role: "light_ring", form: { kind: "ring", shape: "round", w: 34, d: 34, t: 3, h: 6 }, attach: { to: "housing", anchor: "front", offset: [0, 0, 0] }, material: "resin_clear", colour: "sand", finish: "glossy_plastic" },
      ],
    });
    const out = wallFacing(answer);
    for (const id of ["housing", "button", "halo"]) {
      const b = out.bodies.find((x) => x.id === id)!;
      expect(b.attach.anchor, id).toBe("top");
      expect(b.attach.rotate, id).toEqual([90, 0, 0]);
    }
    const g = golden("doorbell");
    const p = ensurePhysical(answer, g.parts, g.spec);
    expect(errorsOf(p.model, "doorbell")).toEqual([]);
    // Every visible layer stands proud of the wall towards the viewer (−y), none sticks out sideways as a shelf.
    const solved = solveProduct(p.model, g.parts, { spec: g.spec });
    const housing = solved.bodies.find((b) => b.id === "housing")!;
    expect(housing.box.max[2] - housing.box.min[2]).toBeGreaterThan(housing.box.max[1] - housing.box.min[1]);
  });
});

describe("pet feeder keeps its bowl and chute", () => {
  it("a forgotten open bowl, a too-small base under the hopper and a chute in the floor are put right", () => {
    const g = golden("cat_feeder");
    // The model's answer: a low base the hopper overhangs, a solid "bowl", a chute pointing into the floor.
    const answer = clampProductModel({
      archetype: "pet_feeder",
      scene: "pet_bowl",
      rationale: "",
      electronicsHost: "base",
      links: [],
      bodies: [
        { id: "base", role: "housing", form: { kind: "rounded_extrude", shape: "rrect", w: 180, d: 98, h: 38, r: 10, fillet: 3 }, attach: { to: "ground", anchor: "top", offset: [0, 0, 0] }, material: "PLA", colour: "sand", finish: "matte_plastic" },
        { id: "hopper", role: "reservoir", form: { kind: "tank", shape: "round", w: 110, d: 110, h: 90, r: 12, lidH: 8, window: 1 }, attach: { to: "base", anchor: "top", offset: [0, 10, 0] }, material: "resin_clear", colour: "mist", finish: "glossy_plastic" },
        { id: "chute", role: "nozzle", form: { kind: "nozzle", length: 30, d: 8, bore: 2.5, angle: 50, drop: 12 }, attach: { to: "base", anchor: "front", offset: [0, 0, -20] }, material: "PLA", colour: "graphite", finish: "matte_plastic" },
        { id: "bowl", role: "base", form: { kind: "lathe_profile", points: [[45, 0], [52, 4], [58, 22], [60, 30]], round: 3, segments: 72 }, attach: { to: "ground", anchor: "top", offset: [0, -160, 0] }, material: "PETG", colour: "coral", finish: "glossy_plastic" },
      ],
    });
    const p = ensurePhysical({ ...answer, scene: "desk" }, g.parts, g.spec);
    // By the food, not on a desk.
    expect(p.model.scene).toBe("pet_bowl");
    const bowls = p.model.bodies.filter((b) => b.shell === "open_top");
    expect(bowls.map((b) => b.id)).toEqual(["bowl"]);
    expect(errorsOf(p.model, "cat_feeder")).toEqual([]);
    const solved = solveProduct(p.model, g.parts, { spec: g.spec });
    const chute = solved.bodies.find((b) => b.id === "chute")!;
    const bowl = solved.bodies.find((b) => b.id === "bowl")!;
    expect(chute.box.min[2]).toBeGreaterThan(bowl.box.max[2]);
    expect(chute.box.min[1]).toBeLessThan(bowl.box.max[1]);
  });

  it("a feeder with no bowl or chute at all gets both", () => {
    const g = golden("cat_feeder");
    const m = structuredClone(archetypeDefault("pet_feeder", g.spec, g.parts));
    m.bodies = m.bodies.filter((b) => b.id !== "bowl" && b.id !== "chute");
    const p = ensurePhysical(m, g.parts, g.spec);
    expect(p.model.bodies.some((b) => b.shell === "open_top")).toBe(true);
    expect(p.model.bodies.some((b) => b.role === "nozzle")).toBe(true);
    expect(errorsOf(p.model, "cat_feeder")).toEqual([]);
  });
});

describe("no light part, no glow", () => {
  it("a glowing halo on a feeder without an LED is dropped", () => {
    const g = golden("cat_feeder");
    const m = structuredClone(archetypeDefault("pet_feeder", g.spec, g.parts));
    m.bodies.push({ ...structuredClone(m.bodies[0]), id: "halo", role: "light_ring", form: { kind: "ring", shape: "round", w: 120, d: 120, t: 3, h: 4, r: 8 }, attach: { to: "base", anchor: "top", offset: [0, 0, 0] }, material: "resin_clear", colour: "sun", finish: "glossy_plastic" });
    expect(ensurePhysical(m, g.parts, g.spec).model.bodies.some((b) => b.id === "halo")).toBe(false);
    const pw = golden("plant_waterer");
    expect(ensurePhysical(archetypeDefault("stake_device", pw.spec, pw.parts), pw.parts, pw.spec).model.bodies.some((b) => b.role === "light_ring")).toBe(true);
  });
});

describe("windows are lenses", () => {
  it("an IR window blown up to a block on the end of a remote is cut back to a lens", () => {
    const g = golden("tv_remote");
    const m = structuredClone(archetypeDefault("handheld", g.spec, g.parts));
    const lens = m.bodies.find((b) => b.id === "lens")!;
    lens.form = { kind: "rounded_extrude", shape: "rrect", w: 14, d: 60, h: 30, r: 6.99, n: 4, fillet: 3 };
    const p = ensurePhysical(m, g.parts, g.spec);
    const out = p.model.bodies.find((b) => b.id === "lens")!;
    expect(out.form.kind).toBe("rounded_extrude");
    if (out.form.kind === "rounded_extrude") {
      expect(out.form.h).toBeLessThanOrEqual(3);
      expect(out.form.d).toBeLessThanOrEqual(0.7 * 24 + 0.1);
    }
    expect(errorsOf(p.model, "tv_remote")).toEqual([]);
  });
});

describe("the default's bodies are kept", () => {
  it("a body the designer dropped comes back from the default, without another model call", () => {
    const g = golden("desk_lamp");
    const def = archetypeDefault("lamp", g.spec, g.parts);
    const answer = structuredClone(def);
    answer.bodies = answer.bodies.filter((b) => b.id !== "touch_pad");
    const restored = restoreDefaultBodies(answer, def);
    expect(restored.bodies.map((b) => b.id).sort()).toEqual(def.bodies.map((b) => b.id).sort());
    const raw = { designs: [{ archetype: "lamp", thinking: {}, why_en: "x", why_ar: "س", model: answer }] };
    const v = validateDesigns(raw, ["lamp"], true, new Map([["lamp", def]]));
    expect(v.errors).toEqual([]);
    expect(v.value![0].model.bodies.some((b) => b.id === "touch_pad")).toBe(true);
  });
});
