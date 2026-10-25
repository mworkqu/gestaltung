import { describe, expect, it } from "vitest";

import { clampSpec, type ProductSpec } from "./schema";
import { IDENTITY_OVERLAP_MIN, identityOverlap, identityScript, identityWords, ideaKey, newIdeaTurn } from "./identity";
import { chargePlan } from "./tiers";

/** A card: only the identity fields matter here (name, one-liner, the goal). */
const card = (name: string, oneLine: string, goal = oneLine, extra: Partial<ProductSpec> = {}): ProductSpec =>
  clampSpec({
    name,
    oneLine,
    quantity: 1,
    understanding: {
      goal,
      howItWorks: "A sensor reads something; the board decides; the output acts.",
      controller: "Arduino Uno",
      sensors: [{ name: "Soil moisture sensor", count: 1 }],
      actuators: [],
      outputs: [{ name: "LED", count: 1 }],
    },
    ...extra,
  });

const WATERER = card("Plant waterer", "Waters a plant when the soil is dry", "Water the plant when the soil gets dry");
const ARM = card("Bench arm", "A desktop robot arm that moves parts on a bench", "Move parts around on a workbench");

describe("identityWords", () => {
  it("reads the name, the one-liner and the goal, and nothing else", () => {
    const words = identityWords(WATERER);
    expect([...words].sort()).toContain("plant");
    expect(words.has("soil")).toBe(true);
    // Parts, outputs and how it works are not identity.
    expect(words.has("arduino")).toBe(false);
    expect(words.has("led")).toBe(false);
  });
  it("drops filler words every card uses", () => {
    expect(identityWords(card("Smart little helper", "A simple automatic device", "It works"))).toEqual(new Set());
  });
  it("folds Arabic spelling and keeps its content words", () => {
    const ar = card("مروية النبات", "يروي النبتة عندما تجف التربه", "ريّ النبتة عند جفاف التربة");
    const words = identityWords(ar);
    expect(words.size).toBeGreaterThan(1);
    expect([...words].some((w) => w.includes("نبت"))).toBe(true);
  });
  it("no card at all has no identity", () => {
    expect(identityWords(null)).toEqual(new Set());
    expect(identityWords(undefined)).toEqual(new Set());
  });
});

describe("identityOverlap", () => {
  it("the same product is 1, a different product is near 0", () => {
    expect(identityOverlap(WATERER, WATERER)).toBe(1);
    expect(identityOverlap(WATERER, ARM)).toBeLessThan(IDENTITY_OVERLAP_MIN);
  });
  it("a missing side means we know nothing, which reads as unchanged (free)", () => {
    expect(identityOverlap(null, ARM)).toBe(1);
    expect(identityOverlap(WATERER, null)).toBe(1);
    expect(identityOverlap(card("Smart helper", "A simple device"), ARM)).toBe(1);
  });
});

describe("newIdeaTurn — refinements are free", () => {
  // Every one of these is a refinement of the plant waterer: detail, parts, size,
  // power, materials, looks. None may ever be charged, hint or no hint.
  const refinements: [string, ProductSpec][] = [
    ["a status light", card("Plant waterer", "Waters a plant when the soil is dry and shows a status light", "Water the plant when the soil gets dry")],
    ["battery power", card("Plant waterer", "Waters a plant when the soil is dry, on batteries", "Water the plant when the soil gets dry")],
    ["a 2 litre tank", card("Plant waterer", "Waters a plant from a 2 litre tank when the soil is dry", "Water the plant when the soil gets dry")],
    ["two plants", card("Plant waterer", "Waters two plants when their soil is dry", "Water the plants when the soil gets dry")],
    ["outdoor and rugged", card("Plant waterer", "Waters a plant outdoors when the soil is dry", "Water the plant when the soil gets dry")],
    ["a renamed card", card("Soil waterer", "Waters a plant when the soil is dry", "Water the plant when the soil gets dry")],
  ];

  it.each(refinements)("%s stays the same product even when the model says otherwise", (_label, after) => {
    const r = newIdeaTurn({ before: WATERER, after, hint: true });
    expect(r.newIdea).toBe(false);
    expect(r.overlap).toBeGreaterThanOrEqual(IDENTITY_OVERLAP_MIN);
  });

  it("a whole batch of refinements in a row is free, every turn", () => {
    let before = WATERER;
    for (const [, after] of refinements) {
      expect(newIdeaTurn({ before, after, hint: true }).newIdea).toBe(false);
      before = after;
    }
  });

  it("the parts list growing is never a new product", () => {
    const withMoreParts = clampSpec({
      ...WATERER,
      understanding: {
        ...WATERER.understanding,
        sensors: [
          { name: "Soil moisture sensor", count: 2 },
          { name: "Temperature sensor", count: 1 },
          { name: "Light sensor", count: 1 },
        ],
        actuators: [{ name: "Water pump", count: 1, kind: "pump" }],
      },
      scope: { controllers: 2, axes: 4 },
    });
    expect(newIdeaTurn({ before: WATERER, after: withMoreParts, hint: true }).newIdea).toBe(false);
  });
});

describe("the EN/AR toggle", () => {
  // The card is written in the page language, so switching language mid-project
  // rebuilds it in the other script. Two cards in different languages share no
  // words whatever the product is, so comparing them would charge someone who was
  // only refining — the one error direction that must not happen.
  const WATERER_AR = card(
    "مروية النبات",
    "تروي النبتة عندما تجف التربة",
    "ريّ النبتة عند جفاف التربة",
  );

  it("reads the dominant script, not a pure one", () => {
    expect(identityScript(identityWords(WATERER))).toBe("latin");
    expect(identityScript(identityWords(WATERER_AR))).toBe("arabic");
    // An Arabic card that keeps a board name in Latin letters is still Arabic.
    const mixed = card(
      "مروية النبات ESP32",
      "تروي النبتة عندما تجف التربة",
      "ريّ النبتة عند جفاف التربة",
    );
    expect(identityScript(identityWords(mixed))).toBe("arabic");
  });

  it("the SAME product rebuilt in the other language is FREE, hint or no hint", () => {
    expect(newIdeaTurn({ before: WATERER, after: WATERER_AR, hint: true }).newIdea).toBe(false);
    expect(newIdeaTurn({ before: WATERER_AR, after: WATERER, hint: true }).newIdea).toBe(false);
    expect(identityOverlap(WATERER, WATERER_AR)).toBe(1);
  });

  it("even a DIFFERENT product in the other language is free: we cannot tell", () => {
    const ARM_AR = card(
      "ذراع المنضدة",
      "ذراع روبوتي ينقل القطع على المنضدة",
      "نقل القطع على منضدة العمل",
    );
    // A deliberate false negative: a free turn costs us almost nothing, charging a
    // refining visitor is the outcome we refuse.
    expect(newIdeaTurn({ before: WATERER, after: ARM_AR, hint: true }).newIdea).toBe(false);
    // In ONE language the same switch is still charged.
    expect(newIdeaTurn({ before: WATERER_AR, after: ARM_AR, hint: true }).newIdea).toBe(true);
  });
});

describe("newIdeaTurn — a different product", () => {
  it("a plant waterer turned into a bench robot arm is a new idea", () => {
    const r = newIdeaTurn({ before: WATERER, after: ARM, hint: true });
    expect(r.newIdea).toBe(true);
    expect(r.overlap).toBeLessThan(IDENTITY_OVERLAP_MIN);
  });

  it("without the model's hint it stays free, however different the card looks", () => {
    expect(newIdeaTurn({ before: WATERER, after: ARM }).newIdea).toBe(false);
    expect(newIdeaTurn({ before: WATERER, after: ARM, hint: false }).newIdea).toBe(false);
  });

  it("no card before, or no new card, is never a new idea", () => {
    expect(newIdeaTurn({ before: null, after: ARM, hint: true }).newIdea).toBe(false);
    expect(newIdeaTurn({ before: WATERER, after: null, hint: true }).newIdea).toBe(false);
  });

  it("ambiguous cards come out FREE rather than charged", () => {
    // A card whose identity words say almost nothing: we cannot tell, so we do not charge.
    const vague = card("New project", "A small device", "Do something useful");
    expect(newIdeaTurn({ before: WATERER, after: vague, hint: true }).newIdea).toBe(false);
    expect(newIdeaTurn({ before: vague, after: ARM, hint: true }).newIdea).toBe(false);
    // Same purpose, different wording: one shared content word is enough to stay free.
    const reworded = card("Pot minder", "Keeps the plant watered", "Keep the plant watered automatically");
    expect(newIdeaTurn({ before: WATERER, after: reworded, hint: true }).newIdea).toBe(false);
  });
});

describe("ideaKey", () => {
  it("is stable for the same idea and different for another one", () => {
    expect(ideaKey(WATERER)).toBe(ideaKey(card("Plant waterer", "Waters a plant when the soil is dry", "Water the plant when the soil gets dry")));
    expect(ideaKey(WATERER)).not.toBe(ideaKey(ARM));
  });
  it("survives a later refinement of the SAME words, so the replay guard keeps holding", () => {
    // Word order does not matter; the key is the set of identity words.
    const same = card("Waterer plant", "Dry soil waters a plant when the", "Water gets the plant when soil the dry");
    expect(ideaKey(same)).toBe(ideaKey(WATERER));
  });
});

describe("chargePlan with a new product", () => {
  it("charges the new product's own tier, not the difference, and asks first", () => {
    // Stored Tier 2 (7 already paid for the old idea); the new product is Tier 2 too.
    const plan = chargePlan({
      storedTier: "maker",
      started: true,
      spec: { ...ARM, scope: { controllers: 1, axes: 4 } },
      newIdea: true,
    });
    expect(plan).toMatchObject({ kind: "new_product", amount: 7, needsApproval: true, tier: { id: "maker" } });
  });

  it("a new Tier 1 product does not inherit the old idea's price and charges nothing", () => {
    const plan = chargePlan({ storedTier: "engineer", started: true, spec: ARM, newIdea: true });
    expect(plan).toMatchObject({ kind: "new_product", amount: 0, needsApproval: false, tier: { id: "explorer" } });
  });

  it("approval charges exactly the quoted amount", () => {
    const spec = { ...ARM, scope: { controllers: 1, customPcb: true } };
    const quoted = chargePlan({ storedTier: "explorer", started: true, spec, newIdea: true });
    expect(quoted).toMatchObject({ amount: 14, needsApproval: true });
    const approved = chargePlan({ storedTier: "explorer", started: true, spec, newIdea: true, approved: "engineer" });
    expect(approved).toMatchObject({ amount: 14, needsApproval: false, kind: "new_product" });
  });

  it("the first idea of a project is a new_idea, never a new_product", () => {
    expect(chargePlan({ started: false, spec: ARM, newIdea: true })).toMatchObject({ kind: "new_idea", amount: 0 });
  });

  it("admins are never charged for a new product either", () => {
    const plan = chargePlan({
      storedTier: "explorer",
      started: true,
      spec: { ...ARM, scope: { controllers: 1, customPcb: true } },
      newIdea: true,
      admin: true,
    });
    expect(plan).toMatchObject({ amount: 0, needsApproval: false });
  });
});
