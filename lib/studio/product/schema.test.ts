import { describe, expect, it } from "vitest";
import { FORM_KINDS, FORM_PARAMS, type ParamDef } from "./forms/params";
import {
  PATCHABLE_PATHS,
  PRODUCT_LIMITS,
  ProductModelSchema,
  applyPatches,
  clampProductModel,
  isPatchAllowed,
  parseProductModel,
  type ProductModel,
} from "./schema";
import type { ClampLog } from "../schema";

const valid = (m: ProductModel) => expect(ProductModelSchema.safeParse(m).success).toBe(true);

const base = (): ProductModel =>
  clampProductModel({
    archetype: "desk_object",
    scene: "desk",
    rationale: "A test product.",
    electronicsHost: "body",
    bodies: [
      { id: "body", role: "housing", form: { kind: "rounded_extrude", w: 80, d: 60, h: 30, r: 10, fillet: 3 }, attach: { to: "ground", anchor: "top" }, material: "PLA", colour: "chalk", finish: "matte_plastic" },
      { id: "lid", role: "lid", form: { kind: "rounded_extrude", w: 80, d: 60, h: 8, r: 10, fillet: 3 }, attach: { to: "body", anchor: "top" }, material: "PLA", colour: "sage", finish: "soft_touch" },
    ],
    links: [],
  });

describe("clampProductModel", () => {
  it("turns nothing into a valid 2-body model, never throws", () => {
    for (const input of [undefined, null, 42, "x", [], {}, { bodies: "no" }, { bodies: [null, 3] }]) {
      const m = clampProductModel(input);
      valid(m);
      expect(m.bodies.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps a valid model unchanged", () => {
    const m = base();
    const log: ClampLog = [];
    expect(clampProductModel(m, log)).toEqual(m);
    expect(log).toEqual([]);
  });

  it("clamps bad enums, numbers and unknown form kinds", () => {
    const log: ClampLog = [];
    const m = clampProductModel(
      {
        archetype: "spaceship",
        scene: "moon",
        rationale: "x".repeat(400),
        bodies: [
          { id: "A B!", role: "wing", form: { kind: "blob", w: 1e9 }, attach: { to: "nowhere", anchor: "sideways", offset: [1e6, "a", -1e6], rotate: [999, 0, 0] }, material: "gold", colour: "pink", finish: "chrome", wall: 99 },
          { id: "b", role: "lid", form: { kind: "rounded_extrude", w: 30, d: 30, h: 400, r: 80, fillet: 50 }, attach: { to: "a_b", anchor: "top" }, material: "pla" },
        ],
      },
      log,
    );
    valid(m);
    expect(m.archetype).toBe("desk_object");
    expect(m.rationale.length).toBe(PRODUCT_LIMITS.rationale.max);
    const [a, b] = m.bodies;
    expect(a.id).toBe("a_b");
    expect(a.form.kind).toBe("rounded_extrude");
    expect(a.attach.to).toBe("ground");
    expect(a.attach.offset).toEqual([300, 0, -300]);
    expect(a.attach.rotate).toEqual([180, 0, 0]);
    expect(a.material).toBe("PLA");
    expect(a.wall).toBe(4);
    expect(b.material).toBe("PLA");
    expect(b.form.kind === "rounded_extrude" && b.form.h).toBe(200);
    // r ≤ half the short side, fillet ≤ half the height and the side.
    expect(b.form.kind === "rounded_extrude" && b.form.r).toBeLessThanOrEqual(15);
    expect(b.form.kind === "rounded_extrude" && b.form.fillet).toBeLessThanOrEqual(12);
    expect(log.length).toBeGreaterThan(5);
  });

  it("caps bodies at 8, makes ids unique, breaks attach cycles", () => {
    const body = (id: string, to: string) => ({ id, role: "housing", form: { kind: "foot" }, attach: { to, anchor: "top" } });
    const m = clampProductModel({ bodies: [body("x", "y"), body("y", "x"), body("x", "ground"), ...Array.from({ length: 10 }, (_, i) => body(`n${i}`, "ground"))] });
    valid(m);
    expect(m.bodies.length).toBe(8);
    expect(new Set(m.bodies.map((b) => b.id)).size).toBe(8);
    // Following parents always ends at ground / scene.
    const byId = new Map(m.bodies.map((b) => [b.id, b]));
    for (const b of m.bodies) {
      let cur = b.attach.to;
      let steps = 0;
      while (byId.has(cur) && steps++ < 10) cur = byId.get(cur)!.attach.to;
      expect(["ground", "scene"]).toContain(cur);
    }
  });

  it("drops links to missing bodies and repairs the electronics host", () => {
    const m = clampProductModel({ ...base(), electronicsHost: "ghost", links: [{ kind: "tube", from: { body: "body", anchor: "top" }, to: { body: "ghost", anchor: "back" } }, { kind: "hose", from: { body: "body", anchor: "back" }, to: { body: "lid", anchor: "top" }, diameter: 20 }] });
    valid(m);
    expect(m.electronicsHost).toBe("body");
    expect(m.links).toHaveLength(1);
    expect(m.links[0].kind).toBe("tube");
    expect(m.links[0].diameter).toBe(8);
  });

  it("every form kind's defaults are valid and every range keeps features printable", () => {
    for (const kind of FORM_KINDS) {
      const m = clampProductModel({ ...base(), bodies: [{ ...base().bodies[0], form: { kind } }, base().bodies[1]] });
      valid(m);
      expect(m.bodies[0].form.kind).toBe(kind);
      for (const [name, d] of Object.entries(FORM_PARAMS[kind] as Record<string, ParamDef>)) {
        if (d.t !== "num") continue;
        // Sizes in mm never go below the printable minimum feature (1.2) except shares / counts.
        if (["taper", "dome", "window", "n", "angle", "drop", "bend", "flutes", "segments", "stem", "seat", "shiftY"].includes(name)) continue;
        expect(d.min, `${kind}.${name}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("repairs a lathe profile (base on z = 0, z never going down)", () => {
    const m = clampProductModel({ ...base(), bodies: [{ ...base().bodies[0], form: { kind: "lathe_profile", points: [[0, 5], [30, 2], [20, 40], { r: 10, z: 30 }] } }, base().bodies[1]] });
    const f = m.bodies[0].form;
    expect(f.kind).toBe("lathe_profile");
    if (f.kind !== "lathe_profile") return;
    expect(f.points[0]).toEqual([4, 0]);
    for (let i = 1; i < f.points.length; i++) expect(f.points[i][1]).toBeGreaterThanOrEqual(f.points[i - 1][1]);
  });

  it("parseProductModel accepts only valid stored values", () => {
    expect(parseProductModel(base())).toEqual(base());
    expect(parseProductModel({ archetype: "x" })).toBeNull();
  });
});

describe("applyPatches (vision loop fixes)", () => {
  it("applies allowed replacements and clamps the result", () => {
    const r = applyPatches(base(), [
      { op: "replace", path: "/bodies/0/form/w", value: 9999 },
      { op: "replace", path: "/bodies/1/colour", value: "coral" },
      { op: "replace", path: "/rationale", value: "Wider and warmer." },
      { op: "add", path: "/bodies/0/features", value: [{ kind: "grille", face: "front", count: 12 }] },
    ]);
    valid(r.model);
    expect(r.applied).toBe(4);
    expect(r.rejected).toEqual([]);
    expect(r.model.bodies[0].form.kind === "rounded_extrude" && r.model.bodies[0].form.w).toBe(240);
    expect(r.model.bodies[1].colour).toBe("coral");
    expect(r.model.bodies[0].features).toEqual([{ kind: "grille", face: "front", count: 12 }]);
  });

  it("rejects paths outside the allow-list (ids, unknown keys) and bad ops", () => {
    const r = applyPatches(base(), [
      { op: "replace", path: "/bodies/0/id", value: "hack" },
      { op: "replace", path: "/bodies/0/secret", value: 1 },
      { op: "move", path: "/bodies/0", from: "/bodies/1" },
      { op: "replace", path: "bodies/0/role" },
      "nonsense",
    ]);
    expect(r.applied).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(["path_not_allowed", "path_not_allowed", "op_not_allowed", "path_not_allowed", "malformed"]);
    expect(r.model).toEqual(base());
  });

  it("never leaves fewer than 2 or more than 8 bodies", () => {
    const r = applyPatches(base(), [{ op: "remove", path: "/bodies/1" }]);
    expect(r.rejected[0].reason).toBe("body_count");
    expect(r.model.bodies).toHaveLength(2);
    const add = Array.from({ length: 9 }, () => ({ op: "add", path: "/bodies/-", value: { id: "knob", role: "button_cap", form: { kind: "knob" }, attach: { to: "lid", anchor: "top" } } }));
    const r2 = applyPatches(base(), add);
    expect(r2.model.bodies).toHaveLength(8);
    expect(r2.rejected.filter((x) => x.reason === "body_count")).toHaveLength(3);
    valid(r2.model);
  });

  it("a removed parent re-attaches its children to the ground", () => {
    const three = applyPatches(base(), [{ op: "add", path: "/bodies/-", value: { id: "cap", role: "button_cap", form: { kind: "button_cap" }, attach: { to: "lid", anchor: "top" } } }]).model;
    const r = applyPatches(three, [{ op: "remove", path: "/bodies/1" }]);
    valid(r.model);
    expect(r.model.bodies.find((b) => b.id === "cap")!.attach.to).toBe("ground");
  });

  it("lists every patchable path with its ops", () => {
    expect(PATCHABLE_PATHS.length).toBeGreaterThan(10);
    expect(isPatchAllowed("replace", "/bodies/3/form/points/2/0")).toBe(true);
    expect(isPatchAllowed("remove", "/bodies/3/attach/rotate")).toBe(true);
    expect(isPatchAllowed("remove", "/archetype")).toBe(false);
    expect(isPatchAllowed("replace", "/bodies/0/form/nonsense")).toBe(false);
  });
});
