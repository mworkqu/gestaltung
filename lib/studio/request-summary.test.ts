import { describe, expect, it } from "vitest";

import { getPart } from "./library";
import { emptyStudioDoc, type MechPart, type StudioDoc } from "./schema";
import { defaultEnclosureFor } from "./enclosure/templates";
import { ESTIMATE_SPREAD, PRINT_BASE_QAR, priceEstimate, printPrice, REQUEST_SENT_KEY, requestSummary } from "./request-summary";

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
