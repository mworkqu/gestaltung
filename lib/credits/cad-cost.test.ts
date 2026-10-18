import { afterEach, describe, expect, it, vi } from "vitest";

import { CAD_CREDIT_COST, REWARDS_DEFAULT, STUDIO_CAD_TIERS, cadCost, studioCadTier } from "./cad-cost";
import { TIERS, tierModel } from "../studio/tiers";

describe("CAD cost by complexity", () => {
  it("simple 1, standard 2, complex 3", () => {
    expect(CAD_CREDIT_COST).toEqual({ simple: 1, standard: 2, complex: 3 });
    expect(cadCost("complex")).toBe(3);
  });
  it("studio builds: tier from the number of parts", () => {
    expect(studioCadTier(0)).toBe("simple");
    expect(studioCadTier(STUDIO_CAD_TIERS.simpleMaxParts)).toBe("simple");
    expect(studioCadTier(STUDIO_CAD_TIERS.simpleMaxParts + 1)).toBe("standard");
    expect(studioCadTier(STUDIO_CAD_TIERS.standardMaxParts + 1)).toBe("complex");
  });
  it("rewards are rebates, not refunds", () => {
    expect(REWARDS_DEFAULT.order_idea_tokens).toBeGreaterThan(0);
    expect(REWARDS_DEFAULT.print_cad_credits).toBe(1);
  });
});

describe("tierModel", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("Explorers keep the default model; Makers and Engineers get a stronger one", () => {
    const [explorer, maker, engineer] = TIERS;
    expect(tierModel(explorer)).toBeUndefined();
    expect(tierModel(maker)).toBeTruthy();
    vi.stubEnv("TIER_MODEL_ENGINEER", "gemini-x-pro");
    expect(tierModel(engineer)).toBe("gemini-x-pro");
  });
});
