// TS copies of SQL rules (REFACTOR_PLAN convention 7). Each test reads the
// LATEST migration that defines the value and compares it with the TS copy, so
// a change on one side fails here. Same approach as
// lib/notifications/kinds-sync.test.ts (regex over the SQL text).
//
// Not repeated here: pricing defaults vs 0051/0062, already pinned by
// lib/pricing/plans.test.ts ("migration 0051 seeds the same defaults").
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REDEEM_DAYS } from "@/lib/credits/constants";
import { redeemableUntil } from "@/lib/credits/redeem-window";
import { LEAD_CLASS_DAYS, parseShippingSettings, type ShippingTier } from "@/lib/store/delivery";
import { activeFreeShipping, freeDeliveryGap, shippingFor, tierShipsFree } from "@/lib/store/shipping";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

/** The latest migration whose text matches `re`, with its file name. */
function latest(re: RegExp): { file: string; sql: string } {
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = read(file);
    if (re.test(sql)) hit = { file, sql };
  }
  if (!hit) throw new Error(`no migration matches ${re}`);
  return hit;
}

/** Text from the start of a match to the closing `$$;` of the function. */
function functionBody(sql: string, header: RegExp): string {
  const m = header.exec(sql);
  if (!m) throw new Error(`no function matches ${header}`);
  const rest = sql.slice(m.index);
  const end = rest.search(/\n\$\$;/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("shipping: store_settings seeds (0044) vs lib/store/shipping.ts + delivery.ts", () => {
  const { sql } = latest(/free_shipping_threshold['"]?\s*,\s*'\{/);
  const threshold = JSON.parse(sql.match(/'free_shipping_threshold',\s*'(\{[^']*\})'::jsonb/)![1]) as { threshold_qar: number; tiers: ShippingTier[] };
  const shippingSeed = JSON.parse(sql.match(/'shipping',\s*'(\{[\s\S]*?\})'::jsonb/)![1]) as {
    handling_fee_qar: number;
    handling_days: number;
    buffer_days: number;
    tiers: Record<ShippingTier, { carrier_cost_qar: number; transit_days: number }>;
  };

  it("the seed is the owner decision: free Standard over QAR 300, flat QAR 50 on every tier", () => {
    expect(threshold).toEqual({ threshold_qar: 300, tiers: ["standard"] });
    for (const t of ["express", "standard", "economy"] as const) expect(shippingSeed.tiers[t].carrier_cost_qar).toBe(50);
    expect(shippingSeed.handling_fee_qar).toBe(0);
  });

  it("tierShipsFree agrees with free_shipping_applies on the seeded config", () => {
    expect(activeFreeShipping(threshold)).toEqual(threshold);
    expect(tierShipsFree("standard", 299.99, threshold)).toBe(false);
    expect(tierShipsFree("standard", 300, threshold)).toBe(true); // SQL: p_goods >= threshold
    expect(tierShipsFree("express", 1000, threshold)).toBe(false); // tier not in the list
    expect(freeDeliveryGap(299.5, threshold)).toBe(1);
    expect(freeDeliveryGap(300, threshold)).toBe(0);
  });

  it("shippingFor charges the flat seeded price, doubles it for a split, and zeroes it when free", () => {
    const base = { tiers: shippingSeed.tiers, handlingFeeQar: shippingSeed.handling_fee_qar, freeShipping: threshold };
    expect(shippingFor({ ...base, tier: "standard", goodsQar: 100 })).toEqual({ shippingQar: 50, handlingQar: 0, free: false });
    expect(shippingFor({ ...base, tier: "standard", goodsQar: 100, split: true }).shippingQar).toBe(100);
    expect(shippingFor({ ...base, tier: "standard", goodsQar: 300, split: true })).toMatchObject({ shippingQar: 0, free: true });
    expect(shippingFor({ ...base, tier: "express", goodsQar: 300 }).shippingQar).toBe(50);
  });

  it("parseShippingSettings fallbacks (handling 1, buffer 3) equal the seeded days", () => {
    const fallbacks = parseShippingSettings({ tiers: { standard: {} } });
    expect(fallbacks).toEqual({ handlingDays: shippingSeed.handling_days, bufferDays: shippingSeed.buffer_days, standardTransitDays: 0 });
    expect(parseShippingSettings(shippingSeed)).toEqual({
      handlingDays: shippingSeed.handling_days,
      bufferDays: shippingSeed.buffer_days,
      standardTransitDays: shippingSeed.tiers.standard.transit_days,
    });
  });
});

describe("order_delivery_quote fallbacks vs parseShippingSettings", () => {
  it("handling_days / buffer_days default to the same numbers in the latest quote function", () => {
    const { sql } = latest(/\(v_cfg ->> 'handling_days'\)::integer/);
    const h = Number(sql.match(/\(v_cfg ->> 'handling_days'\)::integer,\s*(\d+)\)/)![1]);
    const b = Number(sql.match(/\(v_cfg ->> 'buffer_days'\)::integer,\s*(\d+)\)/)![1]);
    expect(parseShippingSettings({ tiers: { standard: {} } })).toMatchObject({ handlingDays: h, bufferDays: b });
  });
});

describe("delivery: LEAD_CLASS_DAYS vs public.lead_class_days()", () => {
  it("has the same class -> days map in the latest definition", () => {
    const { sql } = latest(/create or replace function public\.lead_class_days\(/i);
    const body = functionBody(sql, /create or replace function public\.lead_class_days\(/i);
    const sqlMap = Object.fromEntries([...body.matchAll(/when\s+'([a-z0-9_]+)'\s+then\s+(\d+)/gi)].map((m) => [m[1], Number(m[2])]));
    expect(LEAD_CLASS_DAYS).toEqual(sqlMap);
  });
});

describe("credits: REDEEM_DAYS vs spend_credit", () => {
  const header = /create or replace function public\.spend_credit(?:_for)?\(/i;

  it("every redemption window in the latest spend function is REDEEM_DAYS days from the earn date", () => {
    const { file, sql } = latest(header);
    const body = functionBody(sql, header);
    const days = [...body.matchAll(/v_earned\s*\+\s*interval\s+'(\d+)\s+days?'/gi)].map((m) => Number(m[1]));
    expect(days.length, `${file}: no "v_earned + interval 'N days'" found`).toBeGreaterThan(0);
    for (const d of days) expect(d).toBe(REDEEM_DAYS);
  });

  it("redeemableUntil adds exactly that many days", () => {
    expect(redeemableUntil("2026-10-01T00:00:00Z").toISOString()).toBe(new Date(Date.UTC(2026, 9, 1 + REDEEM_DAYS)).toISOString());
  });
});
