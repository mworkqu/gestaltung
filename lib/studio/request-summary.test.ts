import { describe, expect, it } from "vitest";

import { getPart } from "./library";
import { emptyStudioDoc, type MechPart, type StudioDoc } from "./schema";
import { defaultEnclosureFor } from "./enclosure/templates";
import {
  DEFAULT_QUOTE_RULE,
  ESTIMATE_SPREAD,
  parseFinalQuote,
  parseQuoteCalc,
  parseQuoteRule,
  PRINT_BASE_QAR,
  priceEstimate,
  printPrice,
  QUOTE_RULE_VERSION,
  quoteBreakdown,
  quoteCalcSnapshot,
  quoteDifference,
  REQUEST_SENT_KEY,
  requestSummary,
  validateQuoteRule,
} from "./request-summary";

function doc(): StudioDoc {
  const base = emptyStudioDoc({ ...emptyStudioDoc().spec, name: "Desk buddy", oneLine: "Waves when you walk in." });
  const mech: MechPart[] = [
    { id: "lid", template: "lid", params: {}, printable: { material: "PLA", estGrams: 20.4 } },
    { id: "s1", template: "standoff", params: {}, printable: { material: "PLA", estGrams: 1.2 } },
    { id: "s2", template: "standoff", params: {}, printable: { material: "PLA", estGrams: 1.2 } },
    { id: "base", template: "base", params: {}, printable: { material: "PLA", estGrams: 30 } },
  ];
  return {
    ...base,
    components: [
      { partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "ESP32" },
      { partId: "led_5mm", instanceId: "led_5mm_1", label: "LED" },
      { partId: "no_such_part", instanceId: "x_1", label: "Mystery part" },
    ],
    enclosure: defaultEnclosureFor(base.spec),
    mech,
    answers: { [REQUEST_SENT_KEY]: "2026-10-11T08:00:00.000Z" },
  };
}

describe("priceEstimate", () => {
  it("prints at QAR 100 + QAR 0.7 per gram, plus the parts we sell, and spreads up", () => {
    expect(printPrice(0)).toBe(PRINT_BASE_QAR);
    expect(printPrice(100)).toBeCloseTo(170);
    expect(priceEstimate({ printedGrams: 100, partsQar: 0 })).toEqual({ low: 170, high: 300 });
    const e = priceEstimate({ printedGrams: 100, partsQar: 57 })!;
    expect(e.low).toBe(220);
    expect(e.high).toBe(Math.ceil((227 * ESTIMATE_SPREAD) / 50) * 50);
    expect(e.high).toBeGreaterThan(e.low);
  });
  it("still prices the base with no grams yet, and ignores junk", () => {
    expect(priceEstimate({ printedGrams: 0, partsQar: 0 })).toEqual({ low: 100, high: 150 });
    expect(priceEstimate({ printedGrams: Number.NaN, partsQar: -5 })).toEqual({ low: 100, high: 150 });
  });
});

describe("requestSummary", () => {
  it("lists the parts in the visitor's language, groups printed parts, and keeps the request time", () => {
    const s = requestSummary({ doc: doc(), projectName: "x", getPart, locale: "ar", prices: new Map() });
    expect(s.name).toBe("Desk buddy");
    expect(s.parts.map((p) => p.name)).toEqual([getPart("esp32_devkit")!.name.ar, getPart("led_5mm")!.name.ar, "Mystery part"]);
    expect(s.printed.map((r) => [r.template, r.count])).toEqual([["base", 1], ["lid", 1], ["standoff", 2]]);
    expect(s.printedGrams).toBe(30 + 20 + 2);
    expect(s.enclosure?.template).toBeTruthy();
    expect(s.requestedAt).toBe("2026-10-11T08:00:00.000Z");
    expect(s.estimate).toEqual(priceEstimate({ printedGrams: 52, partsQar: 0 }));
  });
  it("adds the store price of linked parts", () => {
    const part = { ...getPart("led_5mm")!, storeSkus: ["VLT-1"] };
    const lookup = (id: string) => (id === "led_5mm" ? part : getPart(id));
    const s = requestSummary({ doc: doc(), projectName: "x", getPart: lookup, locale: "en", prices: new Map([["VLT-1", 2.5]]) });
    expect(s.partsQar).toBe(2.5);
    expect(s.parts.find((p) => p.id === "led_5mm_1")?.priced).toBe(true);
    expect(s.estimate).toEqual(priceEstimate({ printedGrams: s.printedGrams, partsQar: 2.5 }));
  });
  it("copes with no Studio doc", () => {
    const s = requestSummary({ doc: null, projectName: "Old project", getPart, locale: "en", prices: new Map() });
    expect(s).toMatchObject({ name: "Old project", parts: [], printed: [], enclosure: null, requestedAt: null });
  });
});

describe("quote rule (W2b)", () => {
  it("parses the stored rule and falls back per field", () => {
    expect(parseQuoteRule(null)).toEqual(DEFAULT_QUOTE_RULE);
    expect(parseQuoteRule({ base_qar: 120, per_gram_qar: "0.85", spread: 9 })).toEqual({ base_qar: 120, per_gram_qar: 0.85, spread: 1.5 });
    expect(DEFAULT_QUOTE_RULE).toEqual({ base_qar: 100, per_gram_qar: 0.7, spread: 1.5 });
  });
  it("validates the editor's numbers", () => {
    expect(validateQuoteRule({ base_qar: "100", per_gram_qar: "0.833", spread: "1.5" })).toEqual({ ok: true, rule: { base_qar: 100, per_gram_qar: 0.83, spread: 1.5 } });
    expect(validateQuoteRule({ base_qar: "-1", per_gram_qar: "", spread: "0.5" })).toEqual({ ok: false, bad: ["base_qar", "per_gram_qar", "spread"] });
  });
  it("uses the rule in the estimate", () => {
    const rule = { base_qar: 50, per_gram_qar: 1, spread: 2 };
    expect(printPrice(100, rule)).toBe(150);
    expect(priceEstimate({ printedGrams: 100, partsQar: 0, rule })).toEqual({ low: 150, high: 300 });
  });
});

describe("quoteBreakdown + snapshot (W2b)", () => {
  const part = { ...getPart("esp32_devkit")!, storeSkus: ["VLT-ESP"] };
  const lookup = (id: string) => (id === "esp32_devkit" ? part : getPart(id));

  it("shows every step: grams × rate, base, store prices, subtotal, low and high", () => {
    const b = quoteBreakdown({ doc: doc(), getPart: lookup, prices: new Map([["VLT-ESP", 45]]) });
    expect(b.printed.map((r) => [r.template, r.count, r.grams, r.cost_qar])).toEqual([
      ["base", 1, 30, 21],
      ["lid", 1, 20, 14],
      ["standoff", 2, 2, 1.4],
    ]);
    expect(b.printed[0].name).toBeTruthy();
    expect(b.printedGrams).toBe(52);
    expect(b.gramsQar).toBe(36.4);
    expect(b.printQar).toBe(136.4);
    expect(b.components.map((c) => [c.id, c.sku, c.price_qar])).toEqual([
      ["esp32_devkit_1", "VLT-ESP", 45],
      ["led_5mm_1", null, null],
      ["x_1", null, null],
    ]);
    expect(b.partsQar).toBe(45);
    expect(b.subtotalQar).toBe(181.4);
    expect(b.estimate).toEqual({ low: 180, high: 300 });
    // The client page uses the same numbers.
    const s = requestSummary({ doc: doc(), projectName: "x", getPart: lookup, locale: "en", prices: new Map([["VLT-ESP", 45]]) });
    expect(s.estimate).toEqual(b.estimate);
  });

  it("stores a snapshot the admin can read back", () => {
    const b = quoteBreakdown({ doc: doc(), getPart: lookup, prices: new Map([["VLT-ESP", 45]]), rule: { base_qar: 100, per_gram_qar: 0.7, spread: 1.5 } });
    const snap = quoteCalcSnapshot(b, { ruleSource: "settings", projectId: "p1", projectLink: "https://x/en/projects/p1/studio", now: new Date("2026-10-11T08:00:00Z") });
    expect(snap).toMatchObject({
      v: 1,
      rule_version: QUOTE_RULE_VERSION,
      rule_source: "settings",
      base_qar: 100,
      per_gram_qar: 0.7,
      spread: 1.5,
      printed_grams: 52,
      parts_qar: 45,
      subtotal_qar: 181.4,
      low: 180,
      high: 300,
      midpoint: 240,
      project_id: "p1",
      computed_at: "2026-10-11T08:00:00.000Z",
    });
    expect(parseQuoteCalc(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(parseQuoteCalc(null)).toBeNull();
    expect(parseQuoteCalc({ low: 1 })).toBeNull();
  });

  it("compares the owner's quote with the midpoint", () => {
    expect(quoteDifference(283.2, { midpoint: 240 })).toEqual({ qar: 43.2, pct: 18 });
    expect(quoteDifference(200, { midpoint: 240 })).toEqual({ qar: -40, pct: -16.7 });
    expect(quoteDifference(200, { midpoint: null })).toBeNull();
  });

  it("reads a typed quote", () => {
    expect(parseFinalQuote("1,250")).toBe(1250);
    expect(parseFinalQuote(" 450.556 ")).toBe(450.56);
    expect(parseFinalQuote("٤٥٠")).toBe(450);
    expect(parseFinalQuote("")).toBeNull();
    expect(parseFinalQuote("-5")).toBeNull();
    expect(parseFinalQuote("abc")).toBeNull();
    expect(parseFinalQuote("2000000")).toBeNull();
  });
});

describe("quantities (Part D): identical parts are one row, quantity × price", () => {
  const servo = { ...getPart("mg996r_servo")!, storeSkus: ["VLT-MG"] };
  const lookup = (id: string) => (id === "mg996r_servo" ? servo : getPart(id));
  const armDoc = (): StudioDoc => ({
    ...doc(),
    components: [
      { partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "ESP32" },
      { partId: "mg996r_servo", instanceId: "mg996r_servo_1", label: "Servo" },
      { partId: "mg996r_servo", instanceId: "mg996r_servo_2", label: "Servo" },
      { partId: "mg996r_servo", instanceId: "mg996r_servo_3", label: "Servo" },
      { partId: "sg90_servo", instanceId: "sg90_servo_1", label: "Small servo" },
    ],
  });

  it("groups the breakdown and prices quantity × unit price", () => {
    const b = quoteBreakdown({ doc: armDoc(), getPart: lookup, prices: new Map([["VLT-MG", 40]]) });
    expect(b.components.map((c) => [c.id, c.quantity, c.price_qar])).toEqual([
      ["esp32_devkit_1", 1, null],
      ["mg996r_servo_1", 3, 40],
      ["sg90_servo_1", 1, null],
    ]);
    expect(b.partsQar).toBe(120);
  });

  it("the client summary says 'MG996R … × 3'; old snapshots read as quantity 1", () => {
    const s = requestSummary({ doc: armDoc(), projectName: "x", getPart: lookup, locale: "en", prices: new Map() });
    expect(s.parts[1]).toMatchObject({ quantity: 3, name: `${servo.name.en} × 3` });
    expect(s.parts[0].name).toBe(getPart("esp32_devkit")!.name.en);
    const ar = requestSummary({ doc: armDoc(), projectName: "x", getPart: lookup, locale: "ar", prices: new Map() });
    expect(ar.parts[1].name).toBe(`${servo.name.ar} × 3`);
    const old = parseQuoteCalc({ base_qar: 100, per_gram_qar: 0.7, spread: 1.5, subtotal_qar: 145, components: [{ id: "a", name: "A", price_qar: 45 }] });
    expect(old?.components[0].quantity).toBe(1);
  });
});
