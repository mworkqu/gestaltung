import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_PRICING_PLANS, DEFAULT_SERVICE_PRICES } from "./defaults";
import {
  formatPerOutput,
  formatQar,
  parsePricingPlans,
  parseServicePrices,
  planOrderDesktop,
  planOrderMobile,
} from "./plans";
import { CREDIT_QAR, PROJECT_LIMIT, REDEEM_DAYS } from "@/lib/credits/constants";

const ids = (plans: { id: string }[]) => plans.map((p) => p.id);

describe("parsePricingPlans", () => {
  it("parses the defaults unchanged", () => {
    expect(parsePricingPlans(DEFAULT_PRICING_PLANS)).toEqual(DEFAULT_PRICING_PLANS);
    expect(parsePricingPlans(JSON.stringify(DEFAULT_PRICING_PLANS))).toEqual(DEFAULT_PRICING_PLANS);
  });

  it("falls back to the defaults for missing or invalid values", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not json",
      [],
      { currency: "USD", overage_per_credit_qar: 20, refund_window_days: 30, plans: DEFAULT_PRICING_PLANS.plans },
      { ...DEFAULT_PRICING_PLANS, overage_per_credit_qar: -1 },
      { ...DEFAULT_PRICING_PLANS, plans: [] },
      { ...DEFAULT_PRICING_PLANS, plans: [{ id: "maker" }] },
      { ...DEFAULT_PRICING_PLANS, plans: [DEFAULT_PRICING_PLANS.plans[0], DEFAULT_PRICING_PLANS.plans[0]] },
      { ...DEFAULT_PRICING_PLANS, plans: [{ ...DEFAULT_PRICING_PLANS.plans[1], price_qar_month: "149" }] },
    ]) {
      expect(parsePricingPlans(bad)).toBe(DEFAULT_PRICING_PLANS);
    }
  });

  it("keeps an owner edit", () => {
    const edited = { ...DEFAULT_PRICING_PLANS, overage_per_credit_qar: 25 };
    expect(parsePricingPlans(edited).overage_per_credit_qar).toBe(25);
  });

  it("defaults match the credit rules (0042)", () => {
    expect(DEFAULT_PRICING_PLANS.overage_per_credit_qar).toBe(CREDIT_QAR);
    expect(DEFAULT_PRICING_PLANS.refund_window_days).toBe(REDEEM_DAYS);
    const maker = DEFAULT_PRICING_PLANS.plans.find((p) => p.id === "maker");
    expect(maker && "active_projects" in maker ? maker.active_projects : null).toBe(PROJECT_LIMIT);
  });
});

describe("parseServicePrices", () => {
  it("parses the defaults unchanged", () => {
    expect(parseServicePrices(DEFAULT_SERVICE_PRICES)).toEqual(DEFAULT_SERVICE_PRICES);
  });

  it("falls back to the defaults for missing or invalid values", () => {
    expect(parseServicePrices(null)).toBe(DEFAULT_SERVICE_PRICES);
    expect(parseServicePrices({ ...DEFAULT_SERVICE_PRICES, sprint_from: "20000" })).toBe(DEFAULT_SERVICE_PRICES);
    expect(parseServicePrices({ ...DEFAULT_SERVICE_PRICES, drawing_simple: -5 })).toBe(DEFAULT_SERVICE_PRICES);
  });
});

describe("plan order", () => {
  it("desktop starts with the anchor (studio), then the target (builder)", () => {
    expect(ids(planOrderDesktop(DEFAULT_PRICING_PLANS.plans))).toEqual(["studio", "builder", "maker", "institutions"]);
  });

  it("mobile starts with maker and ends with institutions", () => {
    expect(ids(planOrderMobile(DEFAULT_PRICING_PLANS.plans))).toEqual(["maker", "builder", "studio", "institutions"]);
  });

  it("does not mutate its input", () => {
    const plans = [...DEFAULT_PRICING_PLANS.plans];
    planOrderDesktop(plans);
    planOrderMobile(plans);
    expect(ids(plans)).toEqual(ids(DEFAULT_PRICING_PLANS.plans));
  });
});

describe("formatting", () => {
  it("uses Western digits and drops empty decimals", () => {
    expect(formatQar(20)).toBe("20");
    expect(formatQar(20000)).toBe("20,000");
    expect(formatQar(12.5)).toBe("12.5");
    expect(formatQar(Number.NaN)).toBe("—");
    expect(formatPerOutput(20)).toBe("20");
  });
});

describe("migration 0051 seeds the same defaults", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "0051_pricing_settings.sql"), "utf8");
  const seeded = (key: string): unknown => {
    const m = sql.match(new RegExp(`\\('${key}',\\s*'([^']+)'::jsonb`));
    return m ? JSON.parse(m[1]) : null;
  };

  it("pricing_plans", () => expect(seeded("pricing_plans")).toEqual(DEFAULT_PRICING_PLANS));
  it("service_prices (edm_from came later, 0062)", () => {
    const original: Record<string, unknown> = { ...DEFAULT_SERVICE_PRICES };
    delete original.edm_from;
    expect(seeded("service_prices")).toEqual(original);
  });
  it("0062 adds edm_from without touching other owner edits", () => {
    const add = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "0062_edm_price_drawing_uploads.sql"), "utf8");
    expect(add).toContain(`"edm_from": ${DEFAULT_SERVICE_PRICES.edm_from}`);
    expect(add).toMatch(/not \(value \? 'edm_from'\)/i);
  });
  it("a stored row without edm_from still parses, with the default", () => {
    const old: Record<string, unknown> = { ...DEFAULT_SERVICE_PRICES };
    delete old.edm_from;
    expect(parseServicePrices(old)).toEqual(DEFAULT_SERVICE_PRICES);
  });
  it("never overwrites an owner edit", () => {
    expect(sql).toMatch(/on conflict \(key\) do nothing/i);
    expect(sql).not.toMatch(/do update/i);
  });
});
