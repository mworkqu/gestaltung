import { describe, expect, it } from "vitest";

import { getPart } from "./library";
import { emptyStudioDoc, type MechPart, type StudioDoc } from "./schema";
import { defaultEnclosureFor } from "./enclosure/templates";
import { ESTIMATE_SPREAD, priceEstimate, REQUEST_SENT_KEY, requestSummary } from "./request-summary";

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
  it("starts at the enclosure price plus the parts we sell, and spreads up", () => {
    expect(priceEstimate({ enclosureFrom: 800, partsQar: 0 })).toEqual({ low: 800, high: 1200 });
    const e = priceEstimate({ enclosureFrom: 800, partsQar: 57 })!;
    expect(e.low).toBe(850);
    expect(e.high).toBe(Math.ceil((857 * ESTIMATE_SPREAD) / 50) * 50);
    expect(e.high).toBeGreaterThan(e.low);
  });
  it("is null with nothing to price, and ignores junk", () => {
    expect(priceEstimate({ enclosureFrom: 0, partsQar: 0 })).toBeNull();
    expect(priceEstimate({ enclosureFrom: Number.NaN, partsQar: -5 })).toBeNull();
  });
});

describe("requestSummary", () => {
  it("lists the parts in the visitor's language, groups printed parts, and keeps the request time", () => {
    const s = requestSummary({ doc: doc(), projectName: "x", getPart, locale: "ar", prices: new Map(), enclosureFrom: 800 });
    expect(s.name).toBe("Desk buddy");
    expect(s.parts.map((p) => p.name)).toEqual([getPart("esp32_devkit")!.name.ar, getPart("led_5mm")!.name.ar, "Mystery part"]);
    expect(s.printed.map((r) => [r.template, r.count])).toEqual([["base", 1], ["lid", 1], ["standoff", 2]]);
    expect(s.printedGrams).toBe(30 + 20 + 2);
    expect(s.enclosure?.template).toBeTruthy();
    expect(s.requestedAt).toBe("2026-10-11T08:00:00.000Z");
    expect(s.estimate).toEqual({ low: 800, high: 1200 });
  });
  it("adds the store price of linked parts", () => {
    const part = { ...getPart("led_5mm")!, storeSkus: ["VLT-1"] };
    const lookup = (id: string) => (id === "led_5mm" ? part : getPart(id));
    const s = requestSummary({ doc: doc(), projectName: "x", getPart: lookup, locale: "en", prices: new Map([["VLT-1", 2.5]]), enclosureFrom: 800 });
    expect(s.partsQar).toBe(2.5);
    expect(s.parts.find((p) => p.id === "led_5mm_1")?.priced).toBe(true);
    expect(s.estimate?.low).toBe(800);
  });
  it("copes with no Studio doc", () => {
    const s = requestSummary({ doc: null, projectName: "Old project", getPart, locale: "en", prices: new Map(), enclosureFrom: 800 });
    expect(s).toMatchObject({ name: "Old project", parts: [], printed: [], enclosure: null, requestedAt: null });
  });
});
