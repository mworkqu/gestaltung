import { describe, expect, it } from "vitest";
import { CODE_LIBRARY } from "../library";
import { clampSpec, type ProductSpec } from "../schema";
import type { LayoutInput } from "../layout";
import { archetypeDefault, archetypeFor, defaultProductFor, needsOf, productVariants, rankArchetypes } from "./archetypes";
import { GOLDEN_IDEAS, goldenParts } from "./__fixtures__/golden";
import { ARCHETYPES, ProductModelSchema } from "./schema";
import { solveProduct } from "./solve";

const parts = (...ids: string[]): LayoutInput[] => ids.map((id, i) => ({ instanceId: `${id}_${i + 1}`, part: CODE_LIBRARY.getPart(id)! }));
const spec = (o: Partial<ProductSpec> = {}) => clampSpec({ name: "Test product", oneLine: "", use: "desk", power: "usb", environment: "indoor", features: [], inputs: [], outputs: [], sizeHint: "palm", style: "rounded", quantity: 1, ...o });

/** A typical small electronics set: board + light + button (+ USB-C on the board). */
const KIT = parts("esp32_c3_mini", "led_5mm", "button_6mm");

describe("archetypes", () => {
  it("there are 12, each with a valid, printable, solvable default", () => {
    expect(ARCHETYPES).toHaveLength(12);
    for (const a of ARCHETYPES) {
      for (const [s, p] of [
        [spec(), [] as LayoutInput[]],
        [spec({ inputs: ["button"], outputs: ["led"] }), KIT],
        [spec({ sizeHint: "large", style: "rugged" }), parts("esp32_devkit", "relay_module", "usbc_power_5v")],
      ] as const) {
        const m = archetypeDefault(a, s, p);
        expect(ProductModelSchema.safeParse(m).success, a).toBe(true);
        expect(m.archetype).toBe(a);
        const solved = solveProduct(m, p, { spec: s });
        const errors = solved.issues.filter((i) => i.severity === "error");
        expect(errors, `${a}: ${JSON.stringify(errors)}`).toEqual([]);
        expect(solved.bodies.length).toBeGreaterThanOrEqual(2);
        expect(solved.bodies.length).toBeLessThanOrEqual(8);
        for (const b of solved.bodies) for (const piece of b.pieces) expect(piece.print.fits, `${a}/${piece.id}`).toBe(true);
      }
    }
  });

  it("picks the archetype from the spec (W6 signals + product words)", () => {
    const expected: Record<string, string> = { plant_waterer: "stake_device", desk_lamp: "lamp", cat_feeder: "pet_feeder", doorbell: "wall_mount", tv_remote: "handheld" };
    for (const g of GOLDEN_IDEAS) expect(archetypeFor(g.spec), g.key).toBe(expected[g.key]);
    expect(archetypeFor(spec({ name: "Bike light", use: "vehicle" }))).toBe("vehicle_mount");
    expect(archetypeFor(spec({ name: "Step counter", use: "wearable" }))).toBe("wearable_band");
    expect(archetypeFor(spec({ name: "Weather station", use: "outdoor", environment: "outdoor" }))).toBe("outdoor_box");
    expect(archetypeFor(spec({ name: "Soap dispenser" }))).toBe("dispenser");
    expect(archetypeFor(spec({ name: "Desk robot buddy" }))).toBe("tabletop_robot");
    expect(archetypeFor(spec({ name: "Smart planter", features: ["pebble that sits on the soil"] }))).toBe("planter_insert");
    expect(archetypeFor(spec({ name: "Air quality monitor" }))).toBe("desk_object");
    // Ranked list: every archetype once, best first.
    const r = rankArchetypes(GOLDEN_IDEAS[0].spec);
    expect(new Set(r.map((x) => x.archetype)).size).toBe(12);
    expect(r[0].reason).toBe("plant_soil");
  });

  it("reads the parts and the spec into needs", () => {
    const g = GOLDEN_IDEAS[0];
    expect(needsOf(g.spec, goldenParts(g))).toMatchObject({ pump: true, soil: true, light: true, scale: 1 });
    expect(needsOf(spec({ sizeHint: "large" })).scale).toBeGreaterThan(1);
  });

  it("is deterministic, and Try another gives different archetypes", () => {
    const g = GOLDEN_IDEAS[0];
    expect(defaultProductFor(g.spec, goldenParts(g))).toEqual(defaultProductFor(g.spec, goldenParts(g)));
    const v = productVariants(g.spec, goldenParts(g), "stake_device");
    expect(v).toHaveLength(3);
    expect(new Set(v.map((m) => m.archetype)).size).toBe(3);
    expect(v.map((m) => m.archetype)).not.toContain("stake_device");
  });
});
