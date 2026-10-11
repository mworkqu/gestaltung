import { describe, expect, it } from "vitest";
import { DEFAULT_ENCLOSURE, DEFAULT_SPEC, EnclosureSpecSchema, clampEnclosure, type ProductSpec } from "../schema";
import {
  POT_FRIENDLY,
  applyShapePick,
  defaultEnclosureFor,
  rankShapes,
  shapeReason,
  shapeVariants,
  templateFor,
} from "./shape-pick";

const idea = (o: Partial<ProductSpec> & Record<string, unknown>): ProductSpec => ({ ...DEFAULT_SPEC, ...o }) as ProductSpec;

const PLANT = idea({
  name: "Smart plant monitor",
  oneLine: "Automatic small plant watering monitor",
  features: ["Soil moisture", "Water pump"],
  outputs: ["relay"],
  sizeHint: "palm",
});

describe("template pick from the idea", () => {
  it("plant ideas get a stake pod (and pot-friendly alternatives)", () => {
    expect(templateFor(PLANT)).toBe("stake_pod");
    expect(shapeReason(PLANT, "stake_pod")).toBe("plant");
    const variants = shapeVariants(PLANT, defaultEnclosureFor(PLANT)).map((v) => v.template);
    expect(variants.slice(0, 2).every((t) => POT_FRIENDLY.includes(t))).toBe(true);
    // Arabic idea text and a placement field (W3 placement: plant_soil / on_body / on_wrist) work too.
    expect(templateFor(idea({ name: "مراقب النبتة", oneLine: "يقيس رطوبة التربة" }))).toBe("stake_pod");
    expect(templateFor(idea({ name: "Moisture gadget", placement: "plant_soil" }))).toBe("stake_pod");
    expect(templateFor(idea({ name: "Garden soil probe", use: "outdoor", environment: "outdoor" }))).toBe("stake_pod");
  });

  it("a plant monitor on a wall stays a wall plate", () => {
    expect(templateFor({ ...PLANT, use: "wall" })).toBe("wall_plate");
  });

  it("wearables, handhelds, wall and desk ideas", () => {
    expect(templateFor(idea({ name: "Step counter band", use: "wearable" }))).toBe("pill");
    expect(templateFor(idea({ name: "Clip-on badge", placement: "on_body" }))).toBe("pill");
    expect(templateFor(idea({ name: "TV remote", use: "handheld", sizeHint: "palm" }))).toBe("handheld_taper");
    expect(templateFor(idea({ name: "Key finder", use: "handheld", sizeHint: "pocket" }))).toBe("pill");
    expect(templateFor(idea({ name: "Doorbell panel", use: "wall" }))).toBe("wall_plate");
    expect(templateFor(idea({ name: "Weather station", use: "desk", outputs: ["screen"] }))).toBe("soft_wedge");
    expect(templateFor(idea({ name: "Desk speaker", use: "desk", outputs: ["speaker"], sizeHint: "desk" }))).toBe("lantern");
    expect(templateFor(idea({ name: "Round motion sensor", sizeHint: "palm" }))).toBe("dome_base");
    expect(templateFor(idea({ name: "Round timer", sizeHint: "palm" }))).toBe("puck");
    expect(templateFor(idea({ name: "Garage logger", use: "desk" }))).toBe("rounded_box");
  });

  it("ranks every template once, best first", () => {
    const r = rankShapes(PLANT);
    expect(new Set(r.map((x) => x.template)).size).toBe(r.length);
    expect(r.length).toBe(9);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });

  it("never offers a lantern, dome or stake for something in the hand", () => {
    const top = rankShapes(idea({ name: "Remote", use: "handheld" })).slice(0, 4).map((r) => r.template);
    for (const t of ["lantern", "dome_base", "stake_pod", "wall_plate"]) expect(top).not.toContain(t);
  });
});

describe("other shapes", () => {
  it("three different templates, none the current one, each a valid look keeping colour/finish/label", () => {
    const current = { ...defaultEnclosureFor(PLANT), colour: "coral" as const, finish: "soft_touch" as const, label: "BASIL" };
    const v = shapeVariants(PLANT, current);
    expect(v).toHaveLength(3);
    expect(new Set(v.map((x) => x.template)).size).toBe(3);
    for (const x of v) {
      expect(x.template).not.toBe(current.template);
      expect(EnclosureSpecSchema.safeParse(x).success).toBe(true);
      expect(x.colour).toBe("coral");
      expect(x.finish).toBe("soft_touch");
      expect(x.label).toBe("BASIL");
    }
  });

  it("adapted looks follow template rules (feet, vents, twist lid)", () => {
    const desk = idea({ name: "Air monitor", use: "desk" });
    const current = {
      ...DEFAULT_ENCLOSURE,
      template: "puck" as const,
      lid: "twist" as const,
      vents: { pattern: "holes" as const, face: "-z" as const, count: 8 },
    };
    for (const x of shapeVariants(desk, current, 8)) {
      if (x.template === "stake_pod" || x.template === "wall_plate") expect(x.feet).toBe("none");
      if (x.template === "stake_pod" && x.vents.pattern !== "none") expect(x.vents.face).not.toBe("-z");
      expect(x.lid).not.toBe("twist");
    }
    // Whatever the model sends, a stake pod has no feet and no vents through its socket floor.
    const clamped = clampEnclosure({ ...current, template: "stake_pod", feet: "rubber_4" });
    expect(clamped.feet).toBe("none");
    expect(clamped.vents.face).toBe("+x");
  });
});

describe("first look follows a strong rule", () => {
  const box = { ...DEFAULT_ENCLOSURE, template: "rounded_box" as const, colour: "sage" as const };
  it("a box for a plant becomes a stake pod; colour kept", () => {
    const out = applyShapePick(box, PLANT, []);
    expect(out.template).toBe("stake_pod");
    expect(out.colour).toBe("sage");
  });
  it("a pot-friendly model pick is kept", () => {
    expect(applyShapePick({ ...box, template: "dome_base" }, PLANT, []).template).toBe("dome_base");
  });
  it("later looks (Try another) are left as the model chose", () => {
    expect(applyShapePick(box, PLANT, [box]).template).toBe("rounded_box");
  });
  it("weak rules never override the model", () => {
    const plain = idea({ name: "Garage logger", use: "desk" });
    expect(applyShapePick({ ...box, template: "pill" }, plain, []).template).toBe("pill");
  });
});
