// P5-16 acceptance at the solver level: the five ideas, spec JSON → archetype
// default (no AI) → solved product. The kernel side (watertight meshes, no
// intersecting bodies) is in lib/studio/geometry/product-kernel.test.ts.

import { describe, expect, it } from "vitest";
import { GOLDEN_IDEAS, PLANT_WATERER_IDEA, goldenParts } from "./__fixtures__/golden";
import { defaultProductFor } from "./archetypes";
import { formFrame } from "./forms";
import { ProductModelSchema } from "./schema";
import { MK4_BED, solveProduct } from "./solve";
import { rotate, v3, type Vec3 } from "./shapes";

const solveIdea = (key: string) => {
  const g = GOLDEN_IDEAS.find((x) => x.key === key)!;
  const parts = goldenParts(g);
  const model = defaultProductFor(g.spec, parts);
  return { g, parts, model, s: solveProduct(model, parts, { spec: g.spec }) };
};

describe("golden ideas (no AI)", () => {
  it("uses the owner's Plant Waterer text word for word", () => {
    expect(PLANT_WATERER_IDEA).toContain("Stands in the soil next to the plant, waters with a small pump, lights up to show what it's doing, runs from USB, about the size of your palm.");
  });

  for (const g of GOLDEN_IDEAS) {
    it(`${g.key}: 2–8 bodies, nothing floating or intersecting, all electronics placed, every piece fits an MK4`, () => {
      const { parts, model, s } = solveIdea(g.key);
      expect(ProductModelSchema.safeParse(model).success).toBe(true);
      expect(ProductModelSchema.safeParse(s.model).success).toBe(true);
      expect(s.bodies.length).toBeGreaterThanOrEqual(2);
      expect(s.bodies.length).toBeLessThanOrEqual(8);
      const errors = s.issues.filter((i) => i.severity === "error");
      expect(errors, JSON.stringify(errors)).toEqual([]);
      expect(s.unplaced).toEqual([]);
      const physical = parts.filter((p) => !p.part.helper || p.part.ports.length > 0);
      expect(s.electronics.map((e) => e.instanceId).sort()).toEqual(physical.map((p) => p.instanceId).sort());
      for (const b of s.bodies) {
        for (const p of b.pieces) {
          expect(p.print.fits, p.id).toBe(true);
          expect(Math.max(p.print.size[0], p.print.size[1])).toBeLessThanOrEqual(MK4_BED.x);
          expect(p.print.size[2]).toBeLessThanOrEqual(MK4_BED.z);
        }
      }
      // Deterministic.
      expect(solveProduct(model, parts, { spec: g.spec }).hash).toBe(s.hash);
    });
  }

  it("Plant Waterer: stake + prongs, palm-size head, clear light ring, reachable USB-C, nozzle, tube to a reservoir with the pump", () => {
    const { s } = solveIdea("plant_waterer");
    expect(s.model.archetype).toBe("stake_device");
    expect(s.scene).toBe("plant_pot");
    const by = (pred: (b: (typeof s.bodies)[number]) => boolean) => s.bodies.filter(pred);

    // Stake in the soil, sensor prongs at its tip, the soil probe inside it.
    const [stake] = by((b) => b.form.kind === "stake");
    expect(stake).toBeTruthy();
    expect(stake.box.min[2]).toBeLessThan(-60);
    const [prongs] = by((b) => b.form.kind === "prongs");
    expect(prongs.parent).toBe(stake.id);
    expect(prongs.material).toBe("aluminium");
    expect(s.electronics.find((e) => e.partId === "soil_moisture_cap")!.body).toBe(stake.id);

    // Palm-size head (70–100 mm) holding the board, above the soil.
    const head = s.bodies.find((b) => b.id === s.model.electronicsHost)!;
    const [hw, hd] = formFrame(head.form).size;
    expect(Math.max(hw, hd)).toBeGreaterThanOrEqual(70);
    expect(Math.max(hw, hd)).toBeLessThanOrEqual(100);
    expect(head.box.min[2]).toBeGreaterThan(0);
    expect(s.electronics.find((e) => e.partId === "esp32_c3_mini")!.body).toBe(head.id);

    // A light ring in clear resin, with the LED ring under it.
    const rings = by((b) => b.role === "light_ring");
    expect(rings).toHaveLength(1);
    expect(rings[0].material).toBe("resin_clear");
    expect(s.electronics.find((e) => e.partId === "ws2812_ring")!.body).toBe(head.id);

    // USB-C cut through a face the user can reach (the back; never the bottom).
    const usb = head.cutouts.find((c) => c.kind === "usb_c")!;
    expect(usb).toBeTruthy();
    const n: Vec3 = v3.norm(rotate(head.matrix, usb.normal));
    expect(n[2]).toBeGreaterThan(-0.5);
    expect(n[1]).toBeGreaterThan(0.7);
    expect(s.issues.find((i) => i.code === "usb_unreachable" || i.code === "port_blocked")).toBeUndefined();

    // A drip nozzle over the soil.
    const [nozzle] = by((b) => b.role === "nozzle");
    expect(nozzle.parent).toBe(head.id);
    expect(nozzle.box.min[2]).toBeGreaterThan(0);
    expect(s.issues.find((i) => i.code === "nozzle_off_target")).toBeUndefined();

    // A tube from the reservoir (beside the pot, holding the pump) to the head.
    const [res] = by((b) => b.role === "reservoir");
    expect(res.box.min[0]).toBeGreaterThan(s.stage.pot!.radius);
    expect(s.electronics.find((e) => e.partId === "pump_5v")!.body).toBe(res.id);
    const tube = s.links.find((l) => l.kind === "tube")!;
    expect([tube.from.body, tube.to.body].sort()).toEqual([head.id, res.id].sort());
    expect(tube.length).toBeGreaterThan(50);

    // Shell layers join with a snap lip; the reservoir splits into tank + fill lid.
    expect(head.shell).toBe("open_top");
    expect(head.lip).not.toBeNull();
    expect(res.split?.z).toBeGreaterThan(0);
    expect(s.bodies.length).toBeLessThanOrEqual(8);
  });

  it("the others look like their product (archetype) and carry their controls", () => {
    expect(solveIdea("desk_lamp").s.model.archetype).toBe("lamp");
    expect(solveIdea("desk_lamp").s.bodies.some((b) => b.material === "resin_clear")).toBe(true);
    const feeder = solveIdea("cat_feeder").s;
    expect(feeder.model.archetype).toBe("pet_feeder");
    expect(feeder.bodies.map((b) => b.role)).toEqual(expect.arrayContaining(["reservoir", "button_cap"]));
    const bell = solveIdea("doorbell").s;
    expect(bell.model.archetype).toBe("wall_mount");
    expect(bell.bodies.find((b) => b.role === "button_cap")).toBeTruthy();
    expect(bell.bodies.find((b) => b.role === "light_ring")?.material).toBe("resin_clear");
    expect(bell.bodies.some((b) => b.cutouts.some((c) => c.kind === "speaker_grille"))).toBe(true);
    const remote = solveIdea("tv_remote").s;
    expect(remote.model.archetype).toBe("handheld");
    expect(remote.bodies.find((b) => b.id === remote.model.electronicsHost)!.split).not.toBeNull();
  });
});
