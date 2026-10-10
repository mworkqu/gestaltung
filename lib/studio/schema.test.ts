import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENCLOSURE,
  DEFAULT_SPEC,
  EnclosureSpecSchema,
  LIMITS,
  MECH_PARAMS,
  MECH_TEMPLATES,
  MechPartSchema,
  ProductSpecSchema,
  clampEnclosure,
  clampMechPart,
  clampMechParts,
  clampNum,
  clampSpec,
  emptyStudioDoc,
  parseStudioDoc,
  type ClampLog,
  type EnclosureSpec,
} from "./schema";

const validSpec = {
  name: "Desk Buddy",
  oneLine: "Tells me when the plants need water",
  use: "desk",
  power: "usb",
  environment: "indoor",
  features: ["soil sensor", "green light"],
  inputs: ["button"],
  outputs: ["led", "screen"],
  sizeHint: "palm",
  style: "soft_tech",
  quantity: 1,
};

const validEnclosure: EnclosureSpec = {
  template: "pill",
  proportions: { widthToDepth: 1.6, heightBias: "low" },
  cornerRadius: 10,
  edgeFillet: 1.5,
  wall: 2.4,
  clearance: 2,
  lid: "screw_4",
  vents: { pattern: "slots", face: "+y", count: 6 },
  feet: "rubber_4",
  finish: "soft_touch",
  colour: "sage",
  accentColour: "coral",
  label: "Plant pal",
};

describe("clampNum", () => {
  it("clamps both sides, logs, and accepts numeric strings", () => {
    const log: ClampLog = [];
    expect(clampNum(5, 1, 10, 3, "x", log)).toBe(5);
    expect(log).toEqual([]);
    expect(clampNum(-5, 1, 10, 3, "x", log)).toBe(1);
    expect(clampNum(50, 1, 10, 3, "x", log)).toBe(10);
    expect(clampNum("7", 1, 10, 3, "x", log)).toBe(7);
    expect(log).toHaveLength(3);
    expect(log[2]).toEqual({ path: "x", from: "7", to: 7 });
  });

  it("falls back for NaN, null, undefined, junk, Infinity", () => {
    for (const bad of [NaN, null, undefined, "abc", {}, Infinity, -Infinity]) {
      const log: ClampLog = [];
      expect(clampNum(bad, 1, 10, 4, "n", log)).toBe(4);
      expect(log).toHaveLength(1);
    }
  });

  it("rounds when int is set", () => {
    const log: ClampLog = [];
    expect(clampNum(3.6, 0, 24, 8, "c", log, { int: true })).toBe(4);
    expect(log).toHaveLength(1);
  });
});

describe("clampSpec", () => {
  it("leaves a valid spec untouched with an empty log", () => {
    const log: ClampLog = [];
    const out = clampSpec(validSpec, log);
    expect(out).toEqual(validSpec);
    expect(log).toEqual([]);
    ProductSpecSchema.parse(out);
  });

  it.each([undefined, null, 42, "text", [], NaN])("turns %p into a valid default spec", (bad) => {
    const log: ClampLog = [];
    const out = clampSpec(bad, log);
    expect(out).toEqual(DEFAULT_SPEC);
    expect(log.length).toBeGreaterThan(0);
    ProductSpecSchema.parse(out);
  });

  it("normalises enums and falls back on bad ones", () => {
    const log: ClampLog = [];
    const out = clampSpec({ ...validSpec, use: "WEARABLE", power: "Battery-USB", style: "nonsense", sizeHint: 7 }, log);
    expect(out.use).toBe("wearable");
    expect(out.power).toBe("battery_usb");
    expect(out.style).toBe(DEFAULT_SPEC.style);
    expect(out.sizeHint).toBe(DEFAULT_SPEC.sizeHint);
    expect(log.map((l) => l.path)).toEqual(expect.arrayContaining(["use", "power", "style", "sizeHint"]));
    ProductSpecSchema.parse(out);
  });

  it("defaults environment from use=outdoor", () => {
    expect(clampSpec({ ...validSpec, use: "outdoor", environment: undefined }).environment).toBe("outdoor");
    expect(clampSpec({ ...validSpec, use: "desk", environment: "bogus" }).environment).toBe("indoor");
  });

  it("always forces quantity to 1 and logs a change", () => {
    for (const q of [5, "3", 0, -1, null, NaN]) {
      const log: ClampLog = [];
      expect(clampSpec({ ...validSpec, quantity: q }, log).quantity).toBe(1);
      expect(log.some((l) => l.path === "quantity")).toBe(true);
    }
    const log: ClampLog = [];
    clampSpec({ ...validSpec, quantity: undefined }, log);
    expect(log.some((l) => l.path === "quantity")).toBe(false);
  });

  it("applies name length rules", () => {
    expect(clampSpec({ ...validSpec, name: "ab" }).name).toBe(DEFAULT_SPEC.name);
    expect(clampSpec({ ...validSpec, name: "" }).name).toBe(DEFAULT_SPEC.name);
    expect(clampSpec({ ...validSpec, name: 12 }).name).toBe(DEFAULT_SPEC.name);
    expect(clampSpec({ ...validSpec, name: undefined }).name).toBe(DEFAULT_SPEC.name);
    expect(clampSpec({ ...validSpec, name: "   spaced    out   name  " }).name).toBe("spaced out name");
    expect(clampSpec({ ...validSpec, name: "x".repeat(100) }).name.length).toBe(LIMITS.name.max);
    expect(clampSpec({ ...validSpec, name: "abc" }).name).toBe("abc");
  });

  it("truncates oneLine and defaults non-strings to empty", () => {
    expect(clampSpec({ ...validSpec, oneLine: "y".repeat(500) }).oneLine.length).toBe(LIMITS.oneLine.max);
    expect(clampSpec({ ...validSpec, oneLine: 9 }).oneLine).toBe("");
    expect(clampSpec({ ...validSpec, oneLine: undefined }).oneLine).toBe("");
  });

  it("limits features to 8 items of 60 chars and drops non-strings/blank", () => {
    const log: ClampLog = [];
    const feats = Array.from({ length: 12 }, (_, i) => `feature ${i}`);
    const out = clampSpec({ ...validSpec, features: [...feats, 5, null, "   ", "z".repeat(200)] }, log);
    expect(out.features).toHaveLength(LIMITS.features.max);
    expect(out.features.every((f) => f.length <= LIMITS.features.itemMax)).toBe(true);
    expect(log.some((l) => l.path === "features")).toBe(true);
    expect(clampSpec({ ...validSpec, features: ["z".repeat(200)] }).features[0]).toHaveLength(LIMITS.features.itemMax);
    expect(clampSpec({ ...validSpec, features: "nope" }).features).toEqual([]);
    expect(clampSpec({ ...validSpec, features: undefined }).features).toEqual([]);
    ProductSpecSchema.parse(out);
  });

  it("normalises, dedupes and filters input/output lists", () => {
    const log: ClampLog = [];
    const out = clampSpec({ ...validSpec, inputs: ["Button", "button", "dial", 3, "none"], outputs: ["LED", "Screen", "laser"] }, log);
    expect(out.inputs).toEqual(["button"]);
    expect(out.outputs).toEqual(["led", "screen"]);
    expect(log.some((l) => l.path === "inputs")).toBe(true);
    expect(log.some((l) => l.path === "outputs")).toBe(true);
    expect(clampSpec({ ...validSpec, inputs: ["none"] }).inputs).toEqual(["none"]);
    expect(clampSpec({ ...validSpec, inputs: "button" }).inputs).toEqual([]);
    expect(clampSpec({ ...validSpec, outputs: null }).outputs).toEqual([]);
  });
});

describe("clampEnclosure", () => {
  it("leaves a valid enclosure untouched with an empty log", () => {
    const log: ClampLog = [];
    const out = clampEnclosure(validEnclosure, log);
    expect(out).toEqual(validEnclosure);
    expect(log).toEqual([]);
    EnclosureSpecSchema.parse(out);
  });

  it.each([undefined, null, 5, "box", [], NaN])("turns %p into a valid default", (bad) => {
    const log: ClampLog = [];
    const out = clampEnclosure(bad, log);
    expect(out.template).toBe("rounded_box");
    expect(out.finish).toBe("matte_plastic");
    expect(out.colour).toBe("chalk");
    expect(log.length).toBeGreaterThan(0);
    EnclosureSpecSchema.parse(out);
  });

  it("falls back to documented defaults for bad enums", () => {
    const out = clampEnclosure({
      template: "cube", finish: "shiny", colour: "pink", feet: 1, lid: "glue",
      proportions: { heightBias: "huge" }, vents: { pattern: "stripes", face: "top" },
    });
    expect(out.template).toBe("rounded_box");
    expect(out.finish).toBe("matte_plastic");
    expect(out.colour).toBe("chalk");
    expect(out.feet).toBe("none");
    expect(out.lid).toBe("snap");
    expect(out.proportions.heightBias).toBe("mid");
    expect(out.vents.pattern).toBe("none");
    expect(out.vents.face).toBe("-z");
    EnclosureSpecSchema.parse(out);
  });

  it("normalises enum spelling", () => {
    const log: ClampLog = [];
    const out = clampEnclosure({ ...validEnclosure, template: "Rounded Box", finish: "Matte-Plastic", colour: " GRAPHITE " }, log);
    expect(out.template).toBe("rounded_box");
    expect(out.finish).toBe("matte_plastic");
    expect(out.colour).toBe("graphite");
    expect(log.filter((l) => ["template", "finish", "colour"].includes(l.path))).toHaveLength(3);
  });

  it("clamps numbers on both sides and accepts strings", () => {
    const low = clampEnclosure({ ...validEnclosure, wall: 0.1, cornerRadius: -3, clearance: 0, proportions: { widthToDepth: 0.01, heightBias: "mid" } });
    expect(low.wall).toBe(LIMITS.wall.min);
    expect(low.cornerRadius).toBe(LIMITS.cornerRadius.min);
    expect(low.clearance).toBe(LIMITS.clearance.min);
    expect(low.proportions.widthToDepth).toBe(LIMITS.widthToDepth.min);
    const high = clampEnclosure({ ...validEnclosure, wall: 99, cornerRadius: 99, clearance: 99, edgeFillet: 99, proportions: { widthToDepth: 99, heightBias: "mid" } });
    expect(high.wall).toBe(LIMITS.wall.max);
    expect(high.cornerRadius).toBe(LIMITS.cornerRadius.max);
    expect(high.clearance).toBe(LIMITS.clearance.max);
    expect(high.proportions.widthToDepth).toBe(LIMITS.widthToDepth.max);
    expect(high.edgeFillet).toBeLessThanOrEqual(LIMITS.edgeFillet.max);
    const str = clampEnclosure({ ...validEnclosure, wall: "3", cornerRadius: "12" });
    expect(str.wall).toBe(3);
    expect(str.cornerRadius).toBe(12);
    for (const e of [low, high, str]) EnclosureSpecSchema.parse(e);
  });

  it("uses defaults for NaN/null/undefined numbers", () => {
    for (const bad of [NaN, null, undefined, "x"]) {
      const out = clampEnclosure({ ...validEnclosure, wall: bad, cornerRadius: bad, clearance: bad, edgeFillet: bad, proportions: { widthToDepth: bad, heightBias: "mid" } });
      expect(out.wall).toBe(DEFAULT_ENCLOSURE.wall);
      expect(out.cornerRadius).toBe(DEFAULT_ENCLOSURE.cornerRadius);
      expect(out.clearance).toBe(DEFAULT_ENCLOSURE.clearance);
      expect(out.proportions.widthToDepth).toBe(DEFAULT_ENCLOSURE.proportions.widthToDepth);
      expect(out.edgeFillet).toBeLessThanOrEqual(0.8 * out.wall + 1e-9);
      EnclosureSpecSchema.parse(out);
    }
  });

  it("keeps edgeFillet <= 0.8 * wall (never below the 1 mm floor)", () => {
    expect(clampEnclosure({ ...validEnclosure, wall: 2, edgeFillet: 6 }).edgeFillet).toBeCloseTo(1.6);
    expect(clampEnclosure({ ...validEnclosure, wall: 4, edgeFillet: 6 }).edgeFillet).toBeCloseTo(3.2);
    const floor = clampEnclosure({ ...validEnclosure, wall: 1.6, edgeFillet: 0 });
    expect(floor.edgeFillet).toBe(LIMITS.edgeFillet.min);
    for (const wall of [1.6, 2, 3, 4]) {
      const o = clampEnclosure({ ...validEnclosure, wall, edgeFillet: 6 });
      expect(o.edgeFillet).toBeLessThanOrEqual(Math.max(1, 0.8 * wall) + 1e-9);
    }
  });

  it("limits cornerRadius to 0.33 * min footprint", () => {
    const log: ClampLog = [];
    const out = clampEnclosure({ ...validEnclosure, cornerRadius: 20 }, log, { footprint: { w: 30, d: 60 } });
    expect(out.cornerRadius).toBeCloseTo(9.9);
    expect(log.some((l) => l.path === "cornerRadius")).toBe(true);
    const tiny = clampEnclosure({ ...validEnclosure, cornerRadius: 20 }, [], { footprint: { w: 6, d: 6 } });
    expect(tiny.cornerRadius).toBe(LIMITS.cornerRadius.min);
    const roomy = clampEnclosure({ ...validEnclosure, cornerRadius: 12 }, [], { footprint: { w: 200, d: 100 } });
    expect(roomy.cornerRadius).toBe(12);
    EnclosureSpecSchema.parse(out);
  });

  it("allows the twist lid only for the puck template", () => {
    const log: ClampLog = [];
    expect(clampEnclosure({ ...validEnclosure, template: "rounded_box", lid: "twist" }, log).lid).toBe("snap");
    expect(log.some((l) => l.path === "lid")).toBe(true);
    expect(clampEnclosure({ ...validEnclosure, template: "puck", lid: "twist" }).lid).toBe("twist");
    expect(clampEnclosure({ ...validEnclosure, template: "pill", lid: "Twist" }).lid).toBe("snap");
  });

  it("restricts templates to the allowed option", () => {
    const log: ClampLog = [];
    const out = clampEnclosure({ ...validEnclosure, template: "lantern" }, log, { templates: ["rounded_box", "pill"] });
    expect(out.template).toBe("rounded_box");
    expect(log.some((l) => l.path === "template")).toBe(true);
    expect(clampEnclosure({ ...validEnclosure, template: "pill" }, [], { templates: ["rounded_box", "pill"] }).template).toBe("pill");
    expect(clampEnclosure({ ...validEnclosure, template: "wall_plate" }).template).toBe("wall_plate");
  });

  it("forces vent count 0 when the pattern is none and clamps otherwise", () => {
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "none", face: "+x", count: 12 } }).vents.count).toBe(0);
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "holes", face: "-z", count: 99 } }).vents.count).toBe(LIMITS.ventCount.max);
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "hex", face: "-z", count: -4 } }).vents.count).toBe(LIMITS.ventCount.min);
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "slots", face: "-z", count: 5.6 } }).vents.count).toBe(6);
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "slots", face: "-z", count: "10" } }).vents.count).toBe(10);
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "slots", face: "-z" } }).vents.count).toBe(8);
    expect(clampEnclosure({ ...validEnclosure, vents: "lots" }).vents).toEqual({ pattern: "none", face: "-z", count: 0 });
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "slots", face: "-z", count: NaN } }).vents.count).toBe(8);
  });

  it("accepts grille / louvres; louvres only on a side face; a wall plate has no feet", () => {
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "grille", face: "+z", count: 9 } }).vents).toEqual({ pattern: "grille", face: "+z", count: 9 });
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "louvres", face: "-y", count: 4 } }).vents.face).toBe("-y");
    const log: ClampLog = [];
    expect(clampEnclosure({ ...validEnclosure, vents: { pattern: "Louvres", face: "+z", count: 4 } }, log).vents).toEqual({ pattern: "louvres", face: "+x", count: 4 });
    expect(log.some((l) => l.path === "vents.face" && l.to === "+x")).toBe(true);
    expect(clampEnclosure({ ...validEnclosure, template: "wall_plate", feet: "rubber_4" }).feet).toBe("none");
    expect(clampEnclosure({ ...validEnclosure, template: "dome_base", feet: "ring" }).feet).toBe("ring");
  });

  it("handles accentColour and label", () => {
    expect(clampEnclosure({ ...validEnclosure, colour: "sage", accentColour: "sage" }).accentColour).toBeUndefined();
    expect(clampEnclosure({ ...validEnclosure, accentColour: "magenta" }).accentColour).toBeUndefined();
    expect(clampEnclosure({ ...validEnclosure, accentColour: "Coral" }).accentColour).toBe("coral");
    expect(clampEnclosure({ ...validEnclosure, accentColour: null }).accentColour).toBeUndefined();
    expect(clampEnclosure({ ...validEnclosure, label: "x".repeat(50) }).label).toHaveLength(LIMITS.label.max);
    expect(clampEnclosure({ ...validEnclosure, label: "   " }).label).toBeUndefined();
    expect(clampEnclosure({ ...validEnclosure, label: 9 }).label).toBeUndefined();
    const bare: Record<string, unknown> = { ...validEnclosure };
    delete bare.label;
    delete bare.accentColour;
    const out = clampEnclosure(bare);
    expect("label" in out).toBe(false);
    expect("accentColour" in out).toBe(false);
  });

  it("logs a path for every changed field", () => {
    const log: ClampLog = [];
    clampEnclosure({ ...validEnclosure, wall: 99, clearance: "3", feet: "wheels" }, log);
    expect(log.map((l) => l.path)).toEqual(expect.arrayContaining(["wall", "clearance", "feet"]));
  });

  it("always passes the zod schema for hostile input", () => {
    const hostile = [
      { template: 7, wall: "huge", vents: { pattern: "slots", count: "NaN" }, proportions: null },
      { template: "PUCK", lid: "TWIST", cornerRadius: 1e9, edgeFillet: -1e9, vents: [] },
      { colour: {}, finish: [], accentColour: 3, label: { a: 1 } },
    ];
    for (const h of hostile) EnclosureSpecSchema.parse(clampEnclosure(h, [], { footprint: { w: 40, d: 40 } }));
  });
});

describe("clampMechPart / clampMechParts", () => {
  it("rejects non-objects and unknown templates with null and a log", () => {
    for (const bad of [null, undefined, 3, "standoff", []]) {
      const log: ClampLog = [];
      expect(clampMechPart(bad, log)).toBeNull();
      expect(log).toHaveLength(1);
    }
    const log: ClampLog = [];
    expect(clampMechPart({ template: "rocket" }, log)).toBeNull();
    expect(log[0].path).toBe("mech[0].template");
    expect(clampMechPart({}, [])).toBeNull();
  });

  it("fills every param of every template with its in-range default", () => {
    for (const tpl of MECH_TEMPLATES) {
      const part = clampMechPart({ template: tpl });
      expect(part).not.toBeNull();
      for (const [k, [min, max, def]] of Object.entries(MECH_PARAMS[tpl])) {
        expect(part!.params[k]).toBe(def);
        expect(def).toBeGreaterThanOrEqual(min);
        expect(def).toBeLessThanOrEqual(max);
      }
      MechPartSchema.parse(part);
    }
  });

  it("clamps params on both sides, handles strings and NaN", () => {
    const log: ClampLog = [];
    const p = clampMechPart({ template: "standoff", params: { height: 999, outerD: -1, holeD: "3" } }, log, 2)!;
    expect(p.params.height).toBe(25);
    expect(p.params.outerD).toBe(4);
    expect(p.params.holeD).toBe(3);
    expect(log.some((l) => l.path === "mech[2].params.height")).toBe(true);
    const n = clampMechPart({ template: "standoff", params: { height: NaN, outerD: null } })!;
    expect(n.params.height).toBe(6);
    expect(n.params.outerD).toBe(6);
    MechPartSchema.parse(p);
  });

  it("drops unknown params and normalises the template name", () => {
    const p = clampMechPart({ template: " Standoff ", params: { bogus: 5 } })!;
    expect(p.template).toBe("standoff");
    expect("bogus" in p.params).toBe(false);
  });

  it("validates id, forInstance, material and grams", () => {
    expect(clampMechPart({ template: "lid", id: "my-lid_1" })!.id).toBe("my-lid_1");
    expect(clampMechPart({ template: "lid", id: "bad id!" }, [], 3)!.id).toBe("lid_4");
    expect(clampMechPart({ template: "lid", id: 5 })!.id).toBe("lid_1");
    expect(clampMechPart({ template: "lid", id: "x".repeat(60) })!.id).toBe("lid_1");
    expect(clampMechPart({ template: "lid", forInstance: "esp1" })!.forInstance).toBe("esp1");
    expect(clampMechPart({ template: "lid", forInstance: 5 })!.forInstance).toBeUndefined();
    expect(clampMechPart({ template: "lid", printable: { material: "petg" } })!.printable.material).toBe("PETG");
    expect(clampMechPart({ template: "lid", printable: { material: "steel" } })!.printable.material).toBe("PLA");
    expect(clampMechPart({ template: "lid", printable: { estGrams: -5 } })!.printable.estGrams).toBe(0);
    expect(clampMechPart({ template: "lid", printable: { estGrams: 99999 } })!.printable.estGrams).toBe(2000);
    expect(clampMechPart({ template: "lid", printable: { estGrams: "12" } })!.printable.estGrams).toBe(12);
    expect(clampMechPart({ template: "lid" })!.printable).toEqual({ material: "PLA", estGrams: 5 });
  });

  it("clampMechParts: non-array, dedupes ids, drops invalid, caps at 40", () => {
    const log: ClampLog = [];
    expect(clampMechParts("x", log)).toEqual([]);
    expect(log).toHaveLength(1);
    expect(clampMechParts(undefined)).toEqual([]);
    const out = clampMechParts([{ template: "lid", id: "a" }, { template: "lid", id: "a" }, { template: "nope" }, { template: "base", id: "a" }, null]);
    expect(out.map((m) => m.id)).toEqual(["a", "a_2", "a_3"]);
    for (const m of out) MechPartSchema.parse(m);
    const many = clampMechParts(Array.from({ length: 60 }, () => ({ template: "cable_clip" })));
    expect(many).toHaveLength(40);
    expect(new Set(many.map((m) => m.id)).size).toBe(40);
  });
});

describe("parseStudioDoc", () => {
  it("round-trips an empty doc", () => {
    const doc = emptyStudioDoc();
    expect(parseStudioDoc(doc)).toEqual(doc);
  });

  it("accepts a populated doc built from clamped values", () => {
    const doc = {
      ...emptyStudioDoc(clampSpec(validSpec)),
      enclosure: clampEnclosure(validEnclosure),
      mech: clampMechParts([{ template: "standoff" }]),
      components: [{ partId: "esp32_devkit", instanceId: "i1", label: "Brain" }],
      layout: [{ instanceId: "i1", pos: [0, 0, 3] as [number, number, number], rotZ: 90 as const }],
    };
    expect(parseStudioDoc(doc)).toEqual(doc);
  });

  it.each([undefined, null, 5, "doc", [], {}, { version: 2 }])("returns null for %p", (bad) => {
    expect(parseStudioDoc(bad)).toBeNull();
  });

  it("returns null when a nested field is invalid", () => {
    const doc = emptyStudioDoc();
    expect(parseStudioDoc({ ...doc, spec: { ...doc.spec, quantity: 2 } })).toBeNull();
    expect(parseStudioDoc({ ...doc, layout: [{ instanceId: "a", pos: [0, 0, 0], rotZ: 45 }] })).toBeNull();
    expect(parseStudioDoc({ ...doc, enclosure: { template: "pill" } })).toBeNull();
  });
});
