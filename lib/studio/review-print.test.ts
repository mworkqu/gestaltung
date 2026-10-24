// The printable half of the QA walk of the live Studio, 2026-10. Every test here
// is a file the tester actually downloaded and measured, and the number it must
// now come back with.
//
//   F-003 the STLs were triangle soups (lid: 2,483 unbalanced edges, 297 shells)
//         and the "all parts" plate was 406 mm long, so nothing fitted the MK4;
//   F-004 the same parts weighed 327 g in the slicer, 118 g on the Print step and
//         50 g on the Request page;
//   F-004 a "palm-sized" waterer came out Ø 190 mm;
//   F-005 no opening for the soil probe or the pump, and a flat LiPo got a clip
//         shaped for a cylindrical cell;
//   F-027 two different-sized battery clips were listed as one part "x 2".

import { describe, expect, it, beforeAll } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";

import { PLANT_WATERER } from "./__fixtures__/plant-waterer";
import { getPart } from "./library";
import { isExternalPart, layoutComponents, type LayoutInput } from "./layout";
import { defaultEnclosureFor, enclosureDims, envelopeCap } from "./enclosure/templates";
import { planEnclosure } from "./enclosure/plan";
import { buildEnclosure } from "./geometry/job";
import { defaultMechParts, mechSummary } from "./ai/mech-default";
import { buildMechParts } from "./mech/build";
import { MK4_BED, checkPrintable, platePlan, shellCount } from "./geometry/mesh-check";
import { loadManifold } from "./geometry/manifold-loader";
import { buildProductMeshes } from "./geometry/product-kernel";
import { productStlFiles } from "./geometry/product-preview";
import { solveProduct } from "./product/solve";
import { defaultProductFor } from "./product/archetypes";
import { GOLDEN_IDEAS, goldenParts } from "./product/__fixtures__/golden";
import { gramsFromVolume, printedGramsOf } from "./weight";
import { printedRows, quoteBreakdown, requestSummary } from "./request-summary";
import type { LibraryPart, PrintedList, StudioDoc } from "./schema";
import { emptyStudioDoc } from "./schema";

const HEAVY = 180_000;

// ── The tester's project, as the Studio builds it ────────────────────────────

const items = (): LayoutInput[] => PLANT_WATERER.components.map((c) => ({ instanceId: c.instanceId, part: getPart(c.partId)! }));
const partsMap = () => new Map(PLANT_WATERER.components.map((c) => [c.instanceId, getPart(c.partId)!] as const));

function enclosureOf(template?: "dome_base" | "stake_pod") {
  const spec = { ...defaultEnclosureFor(PLANT_WATERER.spec), ...(template ? { template } : {}) };
  const lr = layoutComponents(items(), { clearance: spec.clearance, sizeHint: PLANT_WATERER.spec.sizeHint });
  return { spec, lr, dims: enclosureDims(spec, lr) };
}

// ── F-004: the size ─────────────────────────────────────────────────────────

describe("F-004 a palm-sized product gets a palm-sized case", () => {
  it("keeps the soil probe and the pump OUT of the case", () => {
    const all = items();
    const inside = layoutComponents(all, { clearance: 2 }).layout.map((l) => l.instanceId);
    expect(inside).not.toContain("soil_moisture_cap_1");
    expect(inside).not.toContain("pump_5v_1");
    // They are external because the PART says so, not because of their name.
    expect(isExternalPart(getPart("soil_moisture_cap")!)).toBe(true);
    expect(isExternalPart(getPart("pump_5v")!)).toBe(true);
    expect(isExternalPart(getPart("esp32_c3_mini")!)).toBe(false);
  });

  it("comes out under 120 mm, whichever pot-friendly shape is chosen", () => {
    for (const template of ["stake_pod", "dome_base"] as const) {
      const { dims } = enclosureOf(template);
      expect(Math.max(dims.W, dims.D), template).toBeLessThan(120);
      expect(dims.H, template).toBeLessThan(120);
    }
  });

  it("never grows past the packed-parts envelope plus margins", () => {
    for (const template of ["stake_pod", "dome_base", "rounded_box", "puck", "pill"] as const) {
      const spec = { ...defaultEnclosureFor(PLANT_WATERER.spec), template };
      const lr = layoutComponents(items(), { clearance: spec.clearance });
      const d = enclosureDims(spec, lr);
      expect(Math.max(d.W, d.D), template).toBeLessThanOrEqual(envelopeCap(spec, lr) + 1e-6);
    }
  });
});

// ── F-005: the case is shaped around the parts ──────────────────────────────

describe("F-005 every part gets a way in", () => {
  it("cuts one opening per port of every part inside the case", () => {
    const { spec, lr } = enclosureOf();
    const parts = partsMap();
    const plan = planEnclosure(spec, lr, parts);
    for (const it of plan.placed) {
      const part = parts.get(it.instanceId)!;
      for (let i = 0; i < part.ports.length; i++) {
        expect(plan.cutouts.some((c) => c.instanceId === it.instanceId && c.portIndex === i), `${it.instanceId}:${i}`).toBe(true);
      }
    }
    // The board's USB-C socket is one of them, on a side wall.
    const usb = plan.cutouts.find((c) => c.kind === "usb_c");
    expect(usb).toBeTruthy();
    expect(usb!.face).not.toBe("+z");
  });

  it("cuts a cable gland for the soil probe and for the pump", () => {
    const { spec, lr } = enclosureOf();
    const plan = planEnclosure(spec, lr, partsMap());
    const leads = plan.cutouts.filter((c) => c.kind === "lead").map((c) => c.instanceId);
    expect(leads).toEqual(expect.arrayContaining(["pump_5v_1", "soil_moisture_cap_1"]));
  });

  it("exports the soil spike named in 'Why this shape' as its own printed body", async () => {
    const { spec, lr } = enclosureOf("stake_pod");
    const parts = partsMap();
    const plan = planEnclosure(spec, lr, parts);
    expect(plan.dims.stake, "a stake pod has a spike").toBeTruthy();
    const summary = mechSummary({
      components: PLANT_WATERER.components,
      layout: plan.placed,
      getPart,
      enclosure: { w: plan.dims.W, d: plan.dims.D, h: plan.dims.H },
      template: plan.dims.template,
    });
    const built = await builtMech(spec, lr, parts, defaultMechParts(summary));
    expect(built.map((b) => b.id)).toContain("stake_spike");
  }, HEAVY);

  it("gives a flat LiPo a flat retainer and a round cell a cradle", () => {
    const shapeOf = (partId: string) => {
      const part = getPart(partId)!;
      const summary = mechSummary({
        components: [{ partId, instanceId: `${partId}_1`, label: partId }],
        layout: [{ instanceId: `${partId}_1`, pos: [0, 0, 0], rotZ: 0 }],
        getPart,
        enclosure: { w: 80, d: 60, h: 30 },
        template: "rounded_box",
      });
      const clip = defaultMechParts(summary).find((m) => m.template === "battery_clip");
      expect(clip, partId).toBeTruthy();
      return { flat: clip!.params.flat, dims: part.dims };
    };
    // lipo_1000 is a pouch: 1 = flat retainer. cell_18650 is cylindrical: 0 = cradle.
    expect(shapeOf("lipo_1000").flat).toBe(1);
    expect(shapeOf("cell_18650").flat).toBe(0);
  });
});

// ── F-027: "x 2" must mean two identical parts ──────────────────────────────

describe("F-027 two parts listed as one line are the same part", () => {
  it("gives clips for different cells different sizes AND different rows", () => {
    const components = [
      { partId: "lipo_1000", instanceId: "lipo_1000_1", label: "lipo" },
      { partId: "cell_18650", instanceId: "cell_18650_1", label: "cell" },
    ];
    const summary = mechSummary({
      components,
      layout: components.map((c, i) => ({ instanceId: c.instanceId, pos: [i * 40, 0, 0] as [number, number, number], rotZ: 0 })),
      getPart,
      enclosure: { w: 120, d: 60, h: 30 },
      template: "rounded_box",
    });
    const clips = defaultMechParts(summary).filter((m) => m.template === "battery_clip");
    expect(clips).toHaveLength(2);
    // Different cells → different params, so the Print step's row key (which now
    // carries the size) can never fold them into one "x 2" line.
    expect(JSON.stringify(clips[0].params)).not.toBe(JSON.stringify(clips[1].params));
  });
});

// ── F-004: ONE weight calculation ───────────────────────────────────────────

describe("F-004 one weight, three call sites", () => {
  const printed: PrintedList = {
    source: "template",
    rows: [
      { key: "base", name: { en: "Case base", ar: "قاعدة" }, material: "PLA", count: 1, grams: 35, printable: true },
      { key: "lid", name: { en: "Case lid", ar: "غطاء" }, material: "PLA", count: 1, grams: 30, printable: true },
      { key: "broken", name: { en: "Spike", ar: "وتد" }, material: "PETG", count: 1, grams: 9, printable: false },
    ],
    grams: 65,
  };
  const doc: StudioDoc = { ...emptyStudioDoc(PLANT_WATERER.spec), printed };

  it("computes grams from mesh volume x density, with no infill factor", () => {
    // 24,450 mm³ of PLA (1.24 g/cm³) is 30 g — what the tester weighed, not the
    // 0.35x "effective fill" the three old call sites each applied.
    expect(gramsFromVolume(24450, "PLA")).toBe(30);
    expect(gramsFromVolume(24450, "PETG")).toBe(31);
    expect(gramsFromVolume(0)).toBe(0);
  });

  it("makes the Print step, the Request page and the quote agree", () => {
    // 1. the Print step's own total (the list it built and stored)
    const printStep = printedGramsOf(printed.rows.filter((r) => r.printable));
    // 2. the quote estimate
    const quote = quoteBreakdown({ doc, getPart, prices: new Map() });
    // 3. the Request page
    const summary = requestSummary({ doc, projectName: "Plant Waterer", getPart, locale: "en", prices: new Map() });
    expect(printStep).toBe(65);
    expect(quote.printedGrams).toBe(printStep);
    expect(summary.printedGrams).toBe(printStep);
    // A body we refused to export is not a body we can price.
    expect(quote.printed.map((r) => r.template)).toEqual(["base", "lid"]);
  });

  it("falls back to the stored mech list for docs saved before the Print step ran", () => {
    const old: StudioDoc = {
      ...emptyStudioDoc(PLANT_WATERER.spec),
      mech: [
        { id: "lid_1", template: "lid", params: {}, printable: { material: "PLA", estGrams: 24 } },
        { id: "base_1", template: "base", params: {}, printable: { material: "PLA", estGrams: 85 } },
      ],
    };
    expect(printedRows(old).reduce((g, r) => g + r.grams, 0)).toBe(109);
  });
});

// ── F-003: printable meshes and plates that fit ─────────────────────────────

describe("F-003 the plate rule", () => {
  it("never lays a plate out larger than the bed, and splits instead", () => {
    const big = Array.from({ length: 9 }, () => ({ w: 90, d: 90, h: 40 }));
    const plan = platePlan(big);
    expect(plan.tooBig).toEqual([]);
    expect(plan.plates.length).toBeGreaterThan(1);
    for (const p of plan.plates) {
      expect(p.w).toBeLessThanOrEqual(MK4_BED.x);
      expect(p.d).toBeLessThanOrEqual(MK4_BED.y);
    }
    // Every part lands on exactly one plate.
    const placed = plan.plates.flatMap((p) => p.items.map((i) => i.index)).sort((a, b) => a - b);
    expect(placed).toEqual(big.map((_, i) => i));
  });

  it("reports a part that no bed can hold instead of silently oversizing a plate", () => {
    const plan = platePlan([{ w: 300, d: 40, h: 20 }, { w: 40, d: 40, h: 20 }]);
    expect(plan.tooBig).toEqual([0]);
    expect(plan.plates.flatMap((p) => p.items.map((i) => i.index))).toEqual([1]);
  });

  it("hands over the template enclosure's own shells — they are closed now", async () => {
    // This is where F-003 bit: the old three-bvh-csg shell was a triangle soup
    // (the dome lid came back with 2,611 unbalanced edges out of 6,275 triangles
    // and manifold-3d refused it), so the Print step had to withhold every file
    // after the CAD credit was already spent. The template path now goes through
    // the product kernel, so the same body comes back printable.
    const { spec, lr } = enclosureOf("dome_base");
    const parts = partsMap();
    const plan = planEnclosure(spec, lr, parts);
    const summary = mechSummary({
      components: PLANT_WATERER.components,
      layout: plan.placed,
      getPart,
      enclosure: { w: plan.dims.W, d: plan.dims.D, h: plan.dims.H },
      template: plan.dims.template,
    });
    const built = await builtMech(spec, lr, parts, defaultMechParts(summary));
    for (const template of ["lid", "base"] as const) {
      const body = built.find((b) => b.template === template)!;
      expect(body.check.watertight, template).toBe(true);
      expect(body.check.badEdges, template).toBe(0);
      expect(body.check.shells, template).toBe(1);
    }
  }, HEAVY);
});

async function builtMech(
  spec: ReturnType<typeof defaultEnclosureFor>,
  lr: ReturnType<typeof layoutComponents>,
  parts: Map<string, LibraryPart>,
  mech: ReturnType<typeof defaultMechParts>,
) {
  const enc = await buildEnclosure(spec, lr, parts);
  return buildMechParts(mech, lr, parts, { base: enc.base, lid: enc.lid, dims: enc.meta.dims });
}

// ── F-003: the product pipeline really is printable ─────────────────────────

describe("F-003 the plant waterer's product bodies are printable (manifold-3d)", () => {
  let mf: ManifoldToplevel;
  beforeAll(async () => {
    mf = await loadManifold();
  }, HEAVY);

  const idea = GOLDEN_IDEAS.find((g) => g.key === "plant_waterer")!;

  it(
    "is watertight, one shell per printed body, consistent winding",
    () => {
      const parts = goldenParts(idea);
      const built = buildProductMeshes(mf, solveProduct(defaultProductFor(idea.spec, parts), parts, { spec: idea.spec }));
      const printed = built.pieces.filter((p) => p.printable);
      expect(printed.length).toBeGreaterThan(2);
      for (const p of printed) {
        const check = checkPrintable({ positions: p.positions, indices: p.indices });
        expect(p.watertight, `${p.id} closed`).toBe(true);
        expect(check.watertight, `${p.id} winding, bad edges ${check.badEdges}`).toBe(true);
        expect(check.badEdges, p.id).toBe(0);
        expect(p.shells, `${p.id} shells`).toBe(1);
        expect(shellCount(p), `${p.id} shells (recounted)`).toBe(1);
      }
    },
    HEAVY,
  );

  it(
    "weighs what its mesh volume says, and its plates fit the bed",
    () => {
      const parts = goldenParts(idea);
      const built = buildProductMeshes(mf, solveProduct(defaultProductFor(idea.spec, parts), parts, { spec: idea.spec }));
      for (const p of built.pieces) {
        if (p.material === "aluminium") continue;
        expect(p.grams, p.id).toBe(gramsFromVolume(p.volumeMm3, p.material === "resin_clear" ? "PETG" : p.material));
      }
      const stl = productStlFiles(built, "plant-waterer");
      expect(stl.unclosed).toEqual([]);
      expect(stl.tooBig).toEqual([]);
      expect(stl.plates.length).toBeGreaterThan(0);
      for (const pl of stl.plates) {
        expect(pl.w).toBeLessThanOrEqual(MK4_BED.x);
        expect(pl.d).toBeLessThanOrEqual(MK4_BED.y);
      }
    },
    HEAVY,
  );
});
