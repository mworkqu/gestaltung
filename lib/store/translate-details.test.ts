import { describe, expect, it } from "vitest";

import {
  cleanArabicText,
  detailsPrompt,
  detailsUpdate,
  parseDetailsTranslation,
  takeBatch,
  translationSource,
  type DetailsSource,
} from "./translate-details";

const part = {
  id: "1",
  sku: "VLT-1",
  name: "Soil Moisture Sensor",
  description: "Soil Moisture Sensor\nMeasures soil moisture.\n\nSpecifications:\n• Voltage: 3.3–5V\n• Output: Analog\n\nLinks\n• 3D model",
};

describe("translationSource", () => {
  it("sends the tidied English description and its spec rows", () => {
    const s = translationSource(part);
    expect(s.description).toBe("Measures soil moisture.");
    expect(s.specs).toEqual([
      { name: "Voltage", value: "3.3–5V" },
      { name: "Output", value: "Analog" },
    ]);
    expect(s.noSpecs).toBe(false);
  });

  it("keeps an existing description_ar unless forced", () => {
    expect(translationSource({ ...part, description_ar: "يقيس رطوبة التربة." }).description).toBeNull();
    expect(translationSource({ ...part, description_ar: "يقيس رطوبة التربة." }, true).description).toBe("Measures soil moisture.");
  });

  it("keeps filled specs_ar unless forced", () => {
    const filled = { ...part, specs_ar: [{ name: "الجهد", value: "3.3–5V" }] };
    expect(translationSource(filled).specs).toEqual([]);
    expect(translationSource(filled, true).specs).toHaveLength(2);
  });
});

describe("takeBatch", () => {
  const src = (chars: number): DetailsSource => ({ description: "x".repeat(chars), specs: [], noSpecs: true });
  const empty: DetailsSource = { description: null, specs: [], noSpecs: true };

  it("caps items and characters, always takes one", () => {
    expect(takeBatch([src(10), src(10), src(10)], 2, 1000)).toBe(2);
    expect(takeBatch([src(600), src(600)], 6, 1000)).toBe(1);
    expect(takeBatch([src(5000)], 6, 1000)).toBe(1);
  });

  it("lets products with nothing to send ride along", () => {
    expect(takeBatch([empty, src(10), empty, src(10), empty, src(10)], 2, 1000)).toBe(5);
    expect(takeBatch([empty, empty])).toBe(2);
  });
});

describe("parseDetailsTranslation", () => {
  const sources: DetailsSource[] = [
    { description: "Measures soil moisture.", specs: [{ name: "Voltage", value: "3.3–5V" }], noSpecs: false },
    { description: "A red LED.", specs: [], noSpecs: true },
    { description: null, specs: [{ name: "Current", value: "20 mA" }], noSpecs: false },
  ];

  it("isolates failures per product", () => {
    const raw = {
      items: [
        { i: 0, description_ar: "يقيس رطوبة التربة.\nروابط\n", specs: [{ n: 0, name: "الجهد", value: "٣.٣–٥V" }] },
        { i: 1, description_ar: "A red LED.", specs: [] }, // echoed English
        { i: 2, description_ar: "", specs: [{ n: 0, name: "التيار", value: "25 mA" }] }, // number changed
      ],
    };
    const r = parseDetailsTranslation(raw, sources);
    expect(r[0]).toEqual({ ok: true, description_ar: "يقيس رطوبة التربة.", specs_ar: [{ name: "الجهد", value: "3.3–5V" }] });
    expect(r[1]).toEqual({ ok: false, reason: "description_not_arabic" });
    expect(r[2]).toEqual({ ok: false, reason: "spec_value_changed" });
  });

  it("fails a product the model left out or answered with missing rows", () => {
    const r = parseDetailsTranslation({ items: [{ i: 0, description_ar: "نص", specs: [] }] }, sources);
    expect(r[0]).toEqual({ ok: false, reason: "spec_rows_missing" });
    expect(r[1]).toEqual({ ok: false, reason: "missing_item" });
    expect(parseDetailsTranslation("garbage", sources).every((x) => !x.ok)).toBe(true);
  });
});

describe("helpers", () => {
  it("cleanArabicText drops boilerplate and uses Western digits", () => {
    expect(cleanArabicText("سطر ١٢\n\n\n• نموذج ثلاثي الأبعاد\n3D Model\nنهاية")).toBe("سطر 12\n\nنهاية");
  });

  it("detailsUpdate writes only what was translated, [] when no specs", () => {
    const src: DetailsSource = { description: "A red LED.", specs: [], noSpecs: true };
    expect(detailsUpdate(src, { ok: true, description_ar: "مصباح LED أحمر.", specs_ar: null }, "T")).toEqual({
      details_ar_at: "T",
      description_ar: "مصباح LED أحمر.",
      specs_ar: [],
    });
    expect(detailsUpdate(src, { ok: false, reason: "x" }, "T")).toBeNull();
  });

  it("detailsPrompt indexes items and rows", () => {
    const p = JSON.parse(detailsPrompt([{ description: null, specs: [{ name: "A", value: "1" }], noSpecs: false }]));
    expect(p).toEqual([{ i: 0, description: "", specs: [{ n: 0, name: "A", value: "1" }] }]);
  });
});
