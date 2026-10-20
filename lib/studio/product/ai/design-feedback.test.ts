// The user-feedback loop of the 3D product designer: the feedback steers a NEW set of
// three, so it (and the regeneration number) must be part of the cache key, or the same
// three designs come back byte-identical.

import { describe, expect, it } from "vitest";

import { fakeModel } from "../../ai/fake-model";
import { Lru } from "../../cache";
import { DesignBody } from "../../server/product";
import { regenCost } from "../../tiers";
import { archetypeDefault } from "../archetypes";
import { GOLDEN_IDEAS, goldenParts } from "../__fixtures__/golden";
import { addDesigns, applyRegen } from "../store";
import { cleanFeedback, designKey, FEEDBACK_LIMIT, pickArchetypes, runProductDesign } from "./design";
import { designerPrompt } from "./prompt";

const g = GOLDEN_IDEAS[0];
const parts = goldenParts(g);
const archetypes = pickArchetypes(g.spec, 1);

const answer = () => ({
  designs: archetypes.map((a) => ({
    archetype: a,
    thinking: { job: "j", use: "u", parts: "p", proportions: "s", look: "l" },
    why_en: "A clear, friendly design that shows what it does.",
    why_ar: "تصميم واضح وودود يُظهر ما يفعله.",
    model: archetypeDefault(a, g.spec, parts),
  })),
});

describe("designKey", () => {
  it("is unchanged when there is no feedback and no attempt (backward compatible)", () => {
    expect(designKey(g.spec, parts, archetypes)).toBe(designKey(g.spec, parts, archetypes, {}));
    expect(designKey(g.spec, parts, archetypes)).toBe(designKey(g.spec, parts, archetypes, { feedback: "   ", attempt: 0 }));
  });

  it("differs with the feedback and with the attempt number", () => {
    const base = designKey(g.spec, parts, archetypes);
    const a = designKey(g.spec, parts, archetypes, { feedback: "too tall", attempt: 1 });
    const b = designKey(g.spec, parts, archetypes, { feedback: "lid hinge is wrong", attempt: 1 });
    const c = designKey(g.spec, parts, archetypes, { feedback: "too tall", attempt: 2 });
    expect(new Set([base, a, b, c]).size).toBe(4);
  });
});

describe("runProductDesign with feedback", () => {
  it("same spec + parts + archetypes but different feedback is a cache MISS (the model is asked again)", async () => {
    const cache = new Lru<unknown>(10);
    const fake = fakeModel([answer(), answer(), answer()]);
    const run = (feedback?: string, attempt?: number) =>
      runProductDesign({ call: fake.call, spec: g.spec, parts, archetypes, cache, feedback, attempt });
    await run();
    await run("too tall, the lid hinge is wrong", 1);
    expect(fake.prompts).toHaveLength(2);
    await run("make it rounder", 1);
    expect(fake.prompts).toHaveLength(3);
    // The very same request is a hit again.
    await run("make it rounder", 1);
    expect(fake.prompts).toHaveLength(3);
  });

  it("puts the feedback into the prompt, next to (not instead of) the brief", async () => {
    const fake = fakeModel([answer()]);
    await runProductDesign({ call: fake.call, spec: g.spec, parts, archetypes, brief: "for my balcony", feedback: "too tall", attempt: 1 });
    expect(fake.prompts[0]).toContain("for my balcony");
    expect(fake.prompts[0]).toContain('"too tall"');
    expect(fake.prompts[0]).toMatch(/NEW designs that fix these complaints/);
  });

  it("no feedback: the prompt has no feedback line", async () => {
    const fake = fakeModel([answer()]);
    await runProductDesign({ call: fake.call, spec: g.spec, parts, archetypes });
    expect(fake.prompts[0]).not.toMatch(/what is wrong with them/);
    expect(designerPrompt({ spec: g.spec, parts: [], starts: [] })).not.toMatch(/what is wrong with them/);
  });
});

describe("feedback text", () => {
  it("is trimmed and capped; the API body caps instead of rejecting", () => {
    expect(cleanFeedback("  hi  ")).toBe("hi");
    expect(cleanFeedback("   ")).toBeNull();
    expect(cleanFeedback("x".repeat(900))).toHaveLength(FEEDBACK_LIMIT);
    const P = "11111111-1111-4111-8111-111111111111";
    expect(DesignBody.parse({ projectId: P, feedback: `  ${"y".repeat(900)}  ` }).feedback).toHaveLength(FEEDBACK_LIMIT);
    expect(DesignBody.parse({ projectId: P }).feedback).toBeUndefined();
  });
});

describe("regeneration count and price", () => {
  it("the first regeneration is free, later ones cost 1 x tier tokens", () => {
    expect(regenCost(0, g.spec)).toBe(0);
    expect(regenCost(1, g.spec)).toBeGreaterThan(0);
    expect(regenCost(5, g.spec)).toBe(regenCost(1, g.spec));
  });

  it("the count is stored in the product doc and survives new designs", () => {
    const empty = { product: { designs: [], chosenId: null, unlockedId: null, specHash: "h" }, priv: { designs: [] } };
    const once = applyRegen(empty);
    expect(once.product.regens).toBe(1);
    const more = addDesigns(once, [], "h");
    expect(more.product.regens).toBe(1);
    expect(applyRegen(more).product.regens).toBe(2);
  });
});
