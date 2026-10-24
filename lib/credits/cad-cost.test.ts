import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CAD_CHARGE_TIER,
  PUBLISHED_CAD_CREDITS,
  REWARDS_DEFAULT,
  SQL_CAD_TIER_COST,
  cadSessionCharge,
  cadTierForCost,
} from "./cad-cost";
import { CAD_GENERATIONS } from "./constants";
import { TIERS, tierModel } from "../studio/tiers";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("messages/en.json")) as Record<string, Record<string, string>>;
const ar = JSON.parse(read("messages/ar.json")) as Record<string, Record<string, string>>;

// F-002: the published price is the contract (Qatar consumer protection — the
// price shown is the price charged). These pin that the number on the button,
// the number Postgres spends and the number /pricing publishes are one number.
describe("the published CAD price is the charged price", () => {
  it("one model = one credit, and that is what Postgres spends", () => {
    expect(PUBLISHED_CAD_CREDITS).toBe(1);
    // cad_begin is handed CAD_CHARGE_TIER, and 0090's cad_tier_cost() turns a
    // tier into credits: the spend must land on the published number.
    expect(SQL_CAD_TIER_COST[CAD_CHARGE_TIER]).toBe(PUBLISHED_CAD_CREDITS);
    expect(cadTierForCost(PUBLISHED_CAD_CREDITS)).toBe(CAD_CHARGE_TIER);
  });

  it("the button label and the spend are the same number", () => {
    const paid = cadSessionCharge("credit");
    // The label interpolates .credits; the route hands cad_begin .tier.
    expect(paid.credits).toBe(PUBLISHED_CAD_CREDITS);
    expect(SQL_CAD_TIER_COST[paid.tier]).toBe(paid.credits);
  });

  it("a version inside the allowance spends nothing", () => {
    // 1 credit covers CAD_GENERATIONS versions: credit_can_use answers
    // "included" for versions 2 and 3, and nothing may be charged for them.
    expect(CAD_GENERATIONS).toBeGreaterThan(1);
    expect(cadSessionCharge("included").credits).toBe(0);
    expect(cadSessionCharge("none").credits).toBe(0);
    // The tier is unchanged, so the included path cannot smuggle in a bigger spend.
    expect(cadSessionCharge("included").tier).toBe(CAD_CHARGE_TIER);
  });

  it("no cad_begin caller prices a session by complexity", () => {
    for (const f of [
      "app/api/cad/route.ts",
      "app/api/studio/enclosure/route.ts",
      "app/api/studio/product/unlock/route.ts",
      "lib/cad/cloud-flow.ts",
    ]) {
      // The tier inside every cad_begin call — the only p_tier that prices a
      // session (set_cad_request's tier only records what kind of model it is).
      const tiers = [...read(f).matchAll(/cad_begin"[\s\S]{0,400}?p_tier:\s*([^,\n]+)/g)].map((m) => m[1].trim());
      expect(tiers.length, f).toBeGreaterThan(0);
      for (const t of tiers) expect(t, f).toBe("CAD_CHARGE_TIER");
    }
  });

  it("the published copy says the same thing in both languages", () => {
    // If the price ever changes, these fail until /pricing and the home page say so.
    expect(PUBLISHED_CAD_CREDITS).toBe(1);
    expect(en.Pricing.creditCostText).toContain("One credit");
    expect(ar.Pricing.creditCostText).toContain("الرصيد الواحد");
    expect(en.SiteV2.credStep3Text).toContain("One credit");
    // The versions in the copy come from CAD_GENERATIONS, not from a literal.
    expect(en.Pricing.creditCostText).toContain("{n}");
    expect(ar.Pricing.creditCostText).toContain("{n}");
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
