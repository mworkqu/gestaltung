// P5-16 Phase 2a golden fixtures: the five acceptance ideas, spec → AI design
// (MOCKED model) → clamp → ensurePhysical (solver homes) → solve. No network.

import { describe, expect, it } from "vitest";

import { fakeModel } from "../../ai/fake-model";
import { Lru } from "../../cache";
import { archetypeDefault } from "../archetypes";
import { GOLDEN_IDEAS, goldenParts } from "../__fixtures__/golden";
import { isLight, isPump, isSoilProbe } from "../parts";
import { ARCHETYPES, ProductModelSchema, type ProductModel } from "../schema";
import { solveProduct } from "../solve";
import { defaultDesign, designKey, modelProblems, pickArchetypes, runProductDesign, validateDesigns } from "./design";
import { ensurePhysical } from "./physical";
import { designerPrompt, designerSchema } from "./prompt";
import { whyFor, whyTemplate } from "./why";

const golden = (key: string) => {
  const g = GOLDEN_IDEAS.find((x) => x.key === key)!;
  return { ...g, parts: goldenParts(g) };
};

/** What a model might answer: the archetype default, "improved" — and missing some functional bodies. */
function aiAnswer(model: ProductModel, opts: { drop?: (b: ProductModel["bodies"][number]) => boolean; opaqueLight?: boolean } = {}): ProductModel {
  const m = structuredClone(model);
  if (opts.drop) {
    const gone = new Set(m.bodies.filter(opts.drop).map((b) => b.id));
    m.bodies = m.bodies.filter((b) => !gone.has(b.id));
    for (const b of m.bodies) if (gone.has(b.attach.to)) b.attach = { to: "ground", anchor: "top", offset: [0, 0, 0] };
    m.links = m.links.filter((l) => !gone.has(l.from.body) && !gone.has(l.to.body));
    if (gone.has(m.electronicsHost)) m.electronicsHost = m.bodies[0].id;
  }
  if (opts.opaqueLight) for (const b of m.bodies) if (b.role === "light_ring" || b.role === "window") b.material = "PLA";
  // A designer touch: a signature colour on the host.
  const host = m.bodies.find((b) => b.id === m.electronicsHost);
  if (host) host.colour = "sage";
  return m;
}

const answerFor = (archetypes: string[], models: ProductModel[], why: { en: string; ar: string }[] = []) => ({
  designs: archetypes.map((a, i) => ({
    archetype: a,
    thinking: { job: "j", use: "u", parts: "p", proportions: "s", look: "l" },
    why_en: why[i]?.en ?? "A clear, friendly design that shows what it does.",
    why_ar: why[i]?.ar ?? "تصميم واضح وودود يُظهر ما يفعله.",
    model: models[i],
  })),
});

/** Every part placed and every actuator / sensor with a physical home. */
function expectComplete(model: ProductModel, parts: ReturnType<typeof goldenParts>, spec: (typeof GOLDEN_IDEAS)[number]["spec"]) {
  expect(ProductModelSchema.safeParse(model).success).toBe(true);
  const solved = solveProduct(model, parts, { spec });
  expect(solved.unplaced).toEqual([]);
  expect(solved.issues.filter((i) => i.code === "part_not_placed")).toEqual([]);
  const ps = parts.map((p) => p.part);
  if (ps.some(isPump)) {
    expect(model.bodies.some((b) => b.role === "reservoir")).toBe(true);
    expect(model.links.some((l) => l.kind === "tube")).toBe(true);
  }
  if (ps.some(isSoilProbe)) {
    expect(model.bodies.some((b) => b.form.kind === "stake")).toBe(true);
    expect(model.bodies.some((b) => b.form.kind === "prongs")).toBe(true);
  }
  if (ps.some(isLight) || spec.outputs.includes("led")) {
    expect(model.bodies.some((b) => b.material === "resin_clear")).toBe(true);
  }
  return solved;
}

describe("pickArchetypes", () => {
  it("ranks for the spec, skips exclude, never repeats", () => {
    const g = golden("plant_waterer");
    const a = pickArchetypes(g.spec, 3);
    expect(a[0]).toBe("stake_device");
    expect(new Set(a).size).toBe(3);
    const b = pickArchetypes(g.spec, 3, a);
    expect(b.some((x) => a.includes(x))).toBe(false);
    expect(pickArchetypes(g.spec, 9)).toHaveLength(3);
    expect(pickArchetypes(g.spec, 2, [...ARCHETYPES])).toEqual([]);
  });
});

describe("designer prompt + schema", () => {
  it("asks in the industrial-designer order and starts from the defaults", () => {
    const g = golden("plant_waterer");
    const archetypes = pickArchetypes(g.spec, 2);
    const p = designerPrompt({ spec: g.spec, parts: [], starts: archetypes.map((a) => ({ archetype: a, model: archetypeDefault(a, g.spec, g.parts) })) });
    expect(p).toContain("Plant Waterer");
    expect(p).toContain("Default design to start from");
    expect(p).toContain("lathe_profile(");
    const s = designerSchema(archetypes) as { properties: { designs: { items: { properties: Record<string, unknown> } } } };
    expect(Object.keys(s.properties.designs.items.properties)).toEqual(["archetype", "thinking", "why_en", "why_ar", "model"]);
  });
});

describe("validateDesigns", () => {
  const g = golden("plant_waterer");
  const archetypes = pickArchetypes(g.spec, 2);
  const good = archetypes.map((a) => archetypeDefault(a, g.spec, g.parts));

  it("accepts sound designs and forces the asked archetype", () => {
    const raw = answerFor(archetypes, good);
    (raw.designs[1].model as { archetype: string }).archetype = "lamp";
    const r = validateDesigns(raw, archetypes, true);
    expect(r.errors).toEqual([]);
    expect(r.value!.map((d) => d.model.archetype)).toEqual(archetypes);
  });

  it("names structural problems (unknown form, broken attach, bad host) instead of silently clamping", () => {
    const bad = structuredClone(good[0]) as unknown as { bodies: { form: { kind: string }; attach: { to: string } }[]; electronicsHost: string };
    bad.bodies[0].form.kind = "blob";
    bad.bodies[1].attach.to = "nowhere";
    bad.electronicsHost = "ghost";
    const problems = modelProblems(bad, "x");
    expect(problems.join("\n")).toMatch(/form.kind/);
    expect(problems.join("\n")).toMatch(/attach.to/);
    expect(problems.join("\n")).toMatch(/electronicsHost/);
    expect(validateDesigns(answerFor(archetypes, [bad as unknown as ProductModel, good[1]]), archetypes, true).value).toBeNull();
    // Lenient (the retry) keeps the sound one.
    const lenient = validateDesigns(answerFor(archetypes, [bad as unknown as ProductModel, good[1]]), archetypes, false);
    expect(lenient.value!.map((d) => d.archetype)).toEqual([archetypes[1]]);
  });

  it("rejects a non-object answer", () => {
    expect(validateDesigns("nope", archetypes, true).value).toBeNull();
    expect(validateDesigns({ designs: "x" }, archetypes, false).value).toBeNull();
  });
});

describe("golden ideas: mocked AI → clamp → every part physical → solve", () => {
  for (const g0 of GOLDEN_IDEAS) {
    it(`${g0.key}: 3 different archetypes, complete, valid, bilingual why`, async () => {
      const g = golden(g0.key);
      const archetypes = pickArchetypes(g.spec, 3);
      // The model "forgets" the reservoir, nozzle, stake prongs and makes the light ring opaque.
      const models = archetypes.map((a) =>
        aiAnswer(archetypeDefault(a, g.spec, g.parts), {
          drop: (b) => b.role === "reservoir" || b.role === "nozzle" || b.form.kind === "prongs",
          opaqueLight: true,
        }),
      );
      const fake = fakeModel([answerFor(archetypes, models)]);
      const run = await runProductDesign({ call: fake.call, spec: g.spec, parts: g.parts, archetypes, brief: g.idea });
      expect(run.source).toBe("model");
      expect(fake.prompts).toHaveLength(1);
      expect(run.designs.map((d) => d.archetype)).toEqual(archetypes);
      expect(new Set(run.designs.map((d) => d.archetype)).size).toBe(3);
      for (const d of run.designs) {
        expect(d.source).toBe("ai");
        expect(d.model.archetype).toBe(d.archetype);
        expectComplete(d.model, g.parts, g.spec);
        // Light rings / windows are clear (light must come through).
        for (const b of d.model.bodies) if (b.role === "light_ring" || b.role === "window") expect(b.material).toBe("resin_clear");
        expect(d.why.en.length).toBeGreaterThan(10);
        expect(d.why.en.length).toBeLessThanOrEqual(160);
        expect(d.why.ar).toMatch(/[؀-ۿ]/);
        expect(d.model.rationale).toBe(d.why.en);
        expect(d.solvedHash).toBe(solveProduct(d.model, g.parts, { spec: g.spec }).hash);
      }
    });
  }

  it("plant waterer: pump → reservoir + tube + outlet, soil probe → stake + prongs, LED → clear ring, USB reachable", async () => {
    const g = golden("plant_waterer");
    const [a] = pickArchetypes(g.spec, 1);
    const stripped = aiAnswer(archetypeDefault(a, g.spec, g.parts), {
      drop: (b) => ["reservoir", "nozzle", "light_ring", "window"].includes(b.role) || b.form.kind === "prongs",
    });
    expect(stripped.bodies.some((b) => b.role === "reservoir")).toBe(false);
    const run = await runProductDesign({ call: fakeModel([answerFor([a], [stripped])]).call, spec: g.spec, parts: g.parts, archetypes: [a] });
    const m = run.designs[0].model;
    expect(m.bodies.some((b) => b.role === "reservoir")).toBe(true);
    expect(m.bodies.some((b) => b.role === "nozzle")).toBe(true);
    expect(m.links.some((l) => l.kind === "tube")).toBe(true);
    expect(m.bodies.some((b) => b.form.kind === "stake")).toBe(true);
    expect(m.bodies.some((b) => b.form.kind === "prongs")).toBe(true);
    expect(m.bodies.some((b) => b.material === "resin_clear")).toBe(true);
    const solved = solveProduct(m, g.parts, { spec: g.spec });
    expect(solved.issues.filter((i) => i.code === "usb_unreachable")).toEqual([]);
    expect(solved.issues.filter((i) => i.code === "light_missing")).toEqual([]);
  });

  it("ensurePhysical is stable: solving its own output adds nothing more", () => {
    for (const g0 of GOLDEN_IDEAS) {
      const g = golden(g0.key);
      for (const a of pickArchetypes(g.spec, 3)) {
        const once = ensurePhysical(archetypeDefault(a, g.spec, g.parts), g.parts, g.spec);
        const twice = ensurePhysical(once.model, g.parts, g.spec);
        expect(twice.issues.filter((i) => i.code === "body_added" || i.code === "link_added")).toEqual([]);
        expect(twice.model.bodies.length).toBe(once.model.bodies.length);
      }
    }
  });
});

describe("fallbacks", () => {
  const g = golden("desk_lamp");
  const archetypes = pickArchetypes(g.spec, 2);

  it("invalid twice → the archetype defaults (never empty)", async () => {
    const fake = fakeModel([{ designs: [] }, { nonsense: true }]);
    const run = await runProductDesign({ call: fake.call, spec: g.spec, parts: g.parts, archetypes });
    expect(fake.prompts).toHaveLength(2);
    expect(fake.prompts[1]).toMatch(/rejected/);
    expect(run.source).toBe("default");
    expect(run.designs.map((d) => d.source)).toEqual(["default", "default"]);
    for (const d of run.designs) {
      expectComplete(d.model, g.parts, g.spec);
      expect(d.why).toEqual(whyTemplate(d.archetype));
    }
  });

  it("first answer broken, retry fixes it → AI designs", async () => {
    const good = archetypes.map((a) => archetypeDefault(a, g.spec, g.parts));
    const fake = fakeModel([answerFor(archetypes, [{ bodies: [] } as unknown as ProductModel, good[1]]), answerFor(archetypes, good)]);
    const run = await runProductDesign({ call: fake.call, spec: g.spec, parts: g.parts, archetypes });
    expect(fake.prompts).toHaveLength(2);
    expect(run.designs.map((d) => d.source)).toEqual(["ai", "ai"]);
  });

  it("retry still half broken → keeps the sound design, defaults the other", async () => {
    const good = archetypes.map((a) => archetypeDefault(a, g.spec, g.parts));
    const half = answerFor(archetypes, [{ bodies: [] } as unknown as ProductModel, good[1]]);
    const run = await runProductDesign({ call: fakeModel([half, half]).call, spec: g.spec, parts: g.parts, archetypes });
    expect(run.designs.map((d) => d.source)).toEqual(["default", "ai"]);
  });

  it("no model (no key) → defaults without a call; provider error → defaults", async () => {
    const run = await runProductDesign({ call: null, spec: g.spec, parts: g.parts, archetypes });
    expect(run.problems).toEqual(["no_model"]);
    expect(run.designs).toHaveLength(2);
    const down = await runProductDesign({ call: fakeModel([new Error("boom"), new Error("boom")]).call, spec: g.spec, parts: g.parts, archetypes });
    expect(down.source).toBe("default");
    expect(down.designs).toHaveLength(2);
  });

  it("caches model answers by spec + parts + archetypes", async () => {
    const good = archetypes.map((a) => archetypeDefault(a, g.spec, g.parts));
    const cache = new Lru<unknown>(10);
    const fake = fakeModel([answerFor(archetypes, good)]);
    await runProductDesign({ call: fake.call, spec: g.spec, parts: g.parts, archetypes, cache });
    const again = await runProductDesign({ call: fake.call, spec: g.spec, parts: g.parts, archetypes, cache });
    expect(fake.prompts).toHaveLength(1);
    expect(again.source).toBe("model");
    expect(designKey(g.spec, [...g.parts].reverse(), archetypes)).toBe(designKey(g.spec, g.parts, archetypes));
  });

  it("defaultDesign is complete for every archetype", () => {
    const pw = golden("plant_waterer");
    for (const a of ARCHETYPES) expectComplete(defaultDesign(a, pw.spec, pw.parts).model, pw.parts, pw.spec);
  });
});

describe("why this design", () => {
  it("has an EN + AR template for every archetype (≤ 160)", () => {
    for (const a of ARCHETYPES) {
      const t = whyTemplate(a);
      expect(t.en.length).toBeGreaterThan(20);
      expect(t.en.length).toBeLessThanOrEqual(160);
      expect(t.ar).toMatch(/[؀-ۿ]/);
      expect(t.ar.length).toBeLessThanOrEqual(160);
    }
  });
  it("uses the AI lines when usable, else the template", () => {
    expect(whyFor("lamp", { en: "Soft light for reading.", ar: "ضوء ناعم للقراءة." })).toEqual({ en: "Soft light for reading.", ar: "ضوء ناعم للقراءة." });
    expect(whyFor("lamp", { en: "ضوء", ar: "Soft light" })).toEqual(whyTemplate("lamp"));
    expect(whyFor("lamp", { en: "x".repeat(400) }).en.length).toBeLessThanOrEqual(160);
  });
});
