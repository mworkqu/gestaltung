// P5-16 vision check: strict JSON reading, patch validation (only allowed paths,
// values decoded), re-clamp + re-solve keeps every part's home. Mocked model.

import { describe, expect, it } from "vitest";

import { fakeModel } from "../../ai/fake-model";
import { archetypeDefault } from "../archetypes";
import { GOLDEN_IDEAS, goldenParts } from "../__fixtures__/golden";
import { applyPatches, ProductModelSchema } from "../schema";
import { solveProduct } from "../solve";
import { ensurePhysical } from "./physical";
import { runVisionCheck, validateVision, visionPrompt } from "./vision";

const g = GOLDEN_IDEAS.find((x) => x.key === "plant_waterer")!;
const parts = goldenParts(g);
const model = ensurePhysical(archetypeDefault("stake_device", g.spec, parts), parts, g.spec).model;
const PNG = "iVBORw0KGgo=";

describe("validateVision", () => {
  it("needs a numeric score; clamps it to 1–10", () => {
    expect(validateVision({}).value).toBeNull();
    expect(validateVision({ score: "high" }).errors[0]).toMatch(/score/);
    expect(validateVision({ score: 42, looksLike: "x", missing: [], patches: [] }).value!.score).toBe(10);
    expect(validateVision({ score: 0 }).value!.score).toBe(1);
    expect(validateVision({ score: "6.6" }).value!.score).toBe(7);
  });

  it("keeps only allowed patch paths and decodes valueJson", () => {
    const v = validateVision({
      score: 5,
      looksLike: "a puck",
      missing: ["water outlet", 7, ""],
      patches: [
        { op: "replace", path: "/bodies/0/form/length", valueJson: "150" },
        { op: "replace", path: "/bodies/0/colour", valueJson: "graphite" },
        { op: "replace", path: "/bodies/0/id", valueJson: '"hacked"' },
        { op: "replace", path: "/__proto__/x", valueJson: "1" },
        { op: "move", path: "/bodies/0", from: "/bodies/1" },
        { op: "add", path: "/bodies/-", valueJson: "{not json" },
        { op: "remove", path: "/links/0" },
      ],
    }).value!;
    expect(v.missing).toEqual(["water outlet"]);
    expect(v.patches).toEqual([
      { op: "replace", path: "/bodies/0/form/length", value: 150 },
      { op: "replace", path: "/bodies/0/colour", value: "graphite" },
      { op: "remove", path: "/links/0" },
    ]);
    expect(v.dropped).toBe(4);
  });

  it("caps patches at 8", () => {
    const patches = Array.from({ length: 11 }, (_, i) => ({ op: "replace", path: `/bodies/0/attach/offset/${i % 3}`, valueJson: String(i) }));
    expect(validateVision({ score: 4, patches }).value!.patches).toHaveLength(8);
  });
});

describe("patches through applyPatches → re-clamp → re-solve", () => {
  it("never produces an invalid model, and removed homes come back", () => {
    const reservoir = model.bodies.findIndex((b) => b.role === "reservoir");
    expect(reservoir).toBeGreaterThan(-1);
    const v = validateVision({
      score: 4,
      patches: [
        { op: "remove", path: `/bodies/${reservoir}` },
        { op: "replace", path: "/bodies/0/form/length", valueJson: "99999" },
        { op: "replace", path: "/bodies/1/material", valueJson: '"unobtainium"' },
      ],
    }).value!;
    const patched = applyPatches(model, v.patches);
    expect(ProductModelSchema.safeParse(patched.model).success).toBe(true);
    const fixed = ensurePhysical(patched.model, parts, g.spec);
    expect(fixed.model.bodies.some((b) => b.role === "reservoir")).toBe(true);
    expect(solveProduct(fixed.model, parts, { spec: g.spec }).unplaced).toEqual([]);
  });
});

describe("runVisionCheck", () => {
  it("asks the at-a-glance question with the spec and the model, returns the reading", async () => {
    const fake = fakeModel([{ score: 8, looksLike: "a plant waterer", missing: [], patches: [] }]);
    const r = await runVisionCheck({ call: fake.call, idea: g.idea, spec: g.spec, partNames: ["Pump"], model, images: { front: PNG, side: PNG, iso: PNG }, loop: 0 });
    expect(r.ok && r.value.score).toBe(8);
    expect(fake.prompts[0]).toMatch(/look like a Plant Waterer at a glance/);
    expect(fake.prompts[0]).toMatch(/functional parts visible/);
  });

  it("an unreadable answer twice → invalid (the route skips and keeps the model)", async () => {
    const r = await runVisionCheck({ call: fakeModel([{}, { score: "?" }]).call, idea: "x", spec: g.spec, partNames: [], model, images: { front: PNG, side: PNG, iso: PNG }, loop: 1 });
    expect(r.ok).toBe(false);
  });

  it("prompt names the round", () => {
    expect(visionPrompt({ idea: "i", spec: g.spec, partNames: [], model, loop: 2 })).toMatch(/round 3 of 3/);
  });
});
