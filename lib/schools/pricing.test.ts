import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHOOL_PRICING,
  SCHOOL_PRICING_KEY,
  parseSchoolPricing,
  perCreditQar,
  schoolPrintPrice,
  validateSchoolPricing,
} from "./pricing";

describe("school pricing", () => {
  it("matches the migration 0096 seed", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../supabase/migrations/0096_school_classes.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).toContain(`'${SCHOOL_PRICING_KEY}'`);
    // The seed is written with jsonb_build_object, so check each number.
    expect(sql).toMatch(/'team_pack',\s*jsonb_build_object\('credits', 3,\s*'qar', 49\)/);
    expect(sql).toMatch(/'class_pack', jsonb_build_object\('credits', 15, 'qar', 199\)/);
    expect(sql).toMatch(/'print',\s*jsonb_build_object\('base_qar', 30, 'per_gram_qar', 0\.7\)/);
    expect(sql).toMatch(/'free_delivery_class_order', true/);
    expect(DEFAULT_SCHOOL_PRICING).toEqual({
      team_pack: { credits: 3, qar: 49 },
      class_pack: { credits: 15, qar: 199 },
      print: { base_qar: 30, per_gram_qar: 0.7 },
      free_delivery_class_order: true,
    });
  });

  it("parses a stored row", () => {
    const stored = {
      team_pack: { credits: 4, qar: 60 },
      class_pack: { credits: 20, qar: 240 },
      print: { base_qar: 25, per_gram_qar: 0.5 },
      free_delivery_class_order: false,
    };
    expect(parseSchoolPricing(stored)).toEqual(stored);
  });

  it("falls back to the defaults for anything unreadable", () => {
    for (const bad of [
      null,
      undefined,
      {},
      "nope",
      [],
      { team_pack: { credits: 0, qar: 49 }, class_pack: { credits: 15, qar: 199 }, print: { base_qar: 30, per_gram_qar: 0.7 }, free_delivery_class_order: true },
      { ...DEFAULT_SCHOOL_PRICING, print: { base_qar: -1, per_gram_qar: 0.7 } },
      { ...DEFAULT_SCHOOL_PRICING, free_delivery_class_order: "yes" },
    ]) {
      expect(parseSchoolPricing(bad)).toEqual(DEFAULT_SCHOOL_PRICING);
    }
  });

  it("tells the admin which field to fix", () => {
    const bad = { ...DEFAULT_SCHOOL_PRICING, team_pack: { credits: 2.5, qar: 49 } };
    const r = validateSchoolPricing(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].field).toBe("team_pack.credits");

    const good = validateSchoolPricing(DEFAULT_SCHOOL_PRICING);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.class_pack.qar).toBe(199);
  });

  it("works out the price per credit", () => {
    expect(perCreditQar({ credits: 3, qar: 49 })).toBe(16.33);
    expect(perCreditQar({ credits: 15, qar: 199 })).toBe(13.27);
    expect(perCreditQar({ credits: 0, qar: 99 })).toBe(0);
  });

  it("prices a school print as base + per gram", () => {
    const rule = DEFAULT_SCHOOL_PRICING.print;
    expect(schoolPrintPrice(0, rule)).toBe(30);
    expect(schoolPrintPrice(40, rule)).toBe(58);
    expect(schoolPrintPrice(123.4, rule)).toBe(116.38);
    // A class print is cheaper than the studio rule (QAR 100 + 0.7/g).
    expect(schoolPrintPrice(40, rule)).toBeLessThan(100 + 0.7 * 40);
    for (const junk of [NaN, -5, Infinity]) expect(schoolPrintPrice(junk, rule)).toBe(30);
  });
});
