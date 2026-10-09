import { describe, expect, it } from "vitest";

import {
  backupLine,
  leadInSentence,
  parsePartSource,
  PRIVATE_PART_FIELDS,
  sourceLine,
  supplierLabel,
  withoutPrivateFields,
} from "@/lib/store/part-source";

describe("parsePartSource", () => {
  it("keeps only supplier, lead class and the backup's sku/supplier/lead", () => {
    const s = parsePartSource({
      supplier: "voltaat",
      lead_time_class: "in_stock",
      cost: 12,
      landed_cost_qar: 30,
      backup: { sku: "DK-1", supplier: "digikey", lead_time_class: "1_2_weeks", cost: 3 },
    });
    expect(s).toEqual({
      supplier: "voltaat",
      leadTimeClass: "in_stock",
      backup: { sku: "DK-1", supplier: "digikey", leadTimeClass: "1_2_weeks" },
    });
  });
  it("null for empty / bad input; an unknown lead class → null", () => {
    expect(parsePartSource(null)).toBeNull();
    expect(parsePartSource([])).toBeNull();
    expect(parsePartSource({ supplier: null, lead_time_class: "soon", backup: null })).toEqual({
      supplier: null,
      leadTimeClass: null,
      backup: null,
    });
  });
});

describe("sourceLine", () => {
  const voltaat = { supplier: "voltaat", leadTimeClass: "in_stock" as const, backup: null };
  it("Voltaat in stock → stocked in Qatar", () => {
    expect(sourceLine(voltaat, "in_stock")).toEqual({ kind: "stocked_local", supplier: "Voltaat" });
  });
  it("Voltaat not in stock → sourced from Voltaat (no lead)", () => {
    expect(sourceLine({ ...voltaat, leadTimeClass: "3_5_days" }, "3_5_days")).toEqual({ kind: "sourced", supplier: "Voltaat" });
  });
  it("DigiKey / Mouser → sourced with the lead class", () => {
    expect(sourceLine({ supplier: "digikey", leadTimeClass: "1_2_weeks", backup: null }, "1_2_weeks")).toEqual({
      kind: "sourced_lead",
      supplier: "DigiKey",
      leadTimeClass: "1_2_weeks",
    });
    expect(sourceLine({ supplier: "mouser", leadTimeClass: "in_stock", backup: null }, "in_stock")).toMatchObject({
      kind: "sourced_lead",
      supplier: "Mouser",
    });
  });
  it("no lead class (no offer) → on request", () => {
    expect(sourceLine(null, null)).toEqual({ kind: "on_request" });
    expect(sourceLine(voltaat, undefined)).toEqual({ kind: "on_request" });
  });
  it("no source data (before 0054) or an unknown supplier → no line", () => {
    expect(sourceLine(null, "in_stock")).toBeNull();
    expect(sourceLine({ supplier: "acme", leadTimeClass: "in_stock", backup: null }, "in_stock")).toBeNull();
  });
});

describe("backupLine", () => {
  it("names the backup's supplier", () => {
    expect(
      backupLine({ supplier: "voltaat", leadTimeClass: null, backup: { sku: "DK-9", supplier: "digikey", leadTimeClass: "2_4_weeks" } }),
    ).toEqual({ supplier: "DigiKey", sku: "DK-9" });
  });
  it("null without a backup or with an unknown supplier", () => {
    expect(backupLine(null)).toBeNull();
    expect(backupLine({ supplier: "voltaat", leadTimeClass: null, backup: null })).toBeNull();
    expect(
      backupLine({ supplier: "voltaat", leadTimeClass: null, backup: { sku: "X", supplier: null, leadTimeClass: null } }),
    ).toBeNull();
  });
});

describe("labels", () => {
  it("supplierLabel", () => {
    expect(supplierLabel("DIGIKEY")).toBe("DigiKey");
    expect(supplierLabel(null)).toBeNull();
  });
  it("leadInSentence lower-cases the English label only", () => {
    expect(leadInSentence("In stock", "en")).toBe("in stock");
    expect(leadInSentence("1–2 weeks", "en")).toBe("1–2 weeks");
    expect(leadInSentence("متوفر", "ar")).toBe("متوفر");
  });
});

describe("withoutPrivateFields", () => {
  it("drops cost / income / sourcing internals and keeps the rest", () => {
    const row = {
      id: "p",
      name: "Relay",
      unit_price: 10,
      lead_time_class: "in_stock",
      landed_cost_qar: 4,
      expected_income_qar: 6,
      income_pct: 60,
      below_floor: false,
      pricing_mode: "markup",
      pinned_offer_id: null,
      preferred_offer_id: "o",
    };
    const clean = withoutPrivateFields(row) as Record<string, unknown>;
    for (const k of PRIVATE_PART_FIELDS) expect(k in clean).toBe(false);
    expect(clean).toEqual({ id: "p", name: "Relay", unit_price: 10, lead_time_class: "in_stock" });
    expect("landed_cost_qar" in row).toBe(true); // the input is not mutated
  });
});
