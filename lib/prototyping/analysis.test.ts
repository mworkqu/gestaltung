import { describe, expect, it } from "vitest";

import { briefStates, honestSources, type Requirement } from "./analysis";

const req = (id: string, value: string, source: Requirement["source"] = "brief"): Requirement => ({
  id,
  label: id,
  value,
  source,
});

describe("honestSources (audit #5)", () => {
  const usbDesk = "Powered from a USB adapter, desk";

  it("downgrades mains when the brief says a USB adapter", () => {
    expect(honestSources([req("power", "mains")], usbDesk)[0].source).toBe("assumed");
  });

  it("downgrades portable when the brief says desk", () => {
    expect(honestSources([req("mounting", "portable")], usbDesk)[0].source).toBe("assumed");
  });

  it("keeps battery from a battery-powered brief", () => {
    expect(honestSources([req("power", "battery")], "It is battery powered")[0].source).toBe("brief");
  });

  it("a desk is indoor", () => {
    expect(honestSources([req("environment", "indoor")], usbDesk)[0].source).toBe("brief");
  });

  it("never upgrades an assumed fact and never changes a value", () => {
    const [r] = honestSources([req("power", "battery", "assumed")], "battery powered");
    expect(r).toEqual(req("power", "battery", "assumed"));
  });

  it("reads Arabic briefs and Arabic-Indic digits", () => {
    expect(briefStates("power", "battery", "يعمل ببطارية قابلة لإعادة الشحن")).toBe(true);
    expect(briefStates("mounting", "fixed", "مثبت على الجدار")).toBe(true);
    expect(briefStates("quantity", "20", "نحتاج ٢٠ قطعة")).toBe(true);
  });

  it("quantity must appear as a number, not inside a model name", () => {
    expect(briefStates("quantity", "20", "a batch of 20 units")).toBe(true);
    expect(briefStates("quantity", "32", "an ESP32 board")).toBe(false);
    expect(briefStates("quantity", "2", "a 20 cm pot")).toBe(false);
  });

  it("a balcony, terrace, patio or roof is outdoor, in English and Arabic", () => {
    for (const b of ["on the balcony", "a rooftop garden unit", "for the terrace", "on a patio table", "on the roof"])
      expect(briefStates("environment", "outdoor", b)).toBe(true);
    expect(briefStates("environment", "outdoor", "يوضع في الشرفة")).toBe(true);
    expect(briefStates("environment", "outdoor", "على البلكونة")).toBe(true);
  });

  it("plugging in says mains; a USB adapter alone does not", () => {
    expect(briefStates("power", "mains", "It is plugged into the wall")).toBe(true);
    expect(briefStates("power", "mains", "just plug it in")).toBe(true);
    expect(briefStates("power", "mains", "Powered from a USB adapter")).toBe(false);
  });

  it("thousands separators don't hide a quantity", () => {
    expect(briefStates("quantity", "1000", "a first run of 1,000 units")).toBe(true);
    expect(briefStates("quantity", "1000", "نحتاج ١٬٠٠٠ قطعة")).toBe(true);
    expect(briefStates("quantity", "1", "a first run of 1,000 units")).toBe(false);
  });

  it("environment both needs both kinds of words", () => {
    expect(briefStates("environment", "both", "used in the office and the garden")).toBe(true);
    expect(briefStates("environment", "both", "used in the office")).toBe(false);
  });

  it("free-text facts keep 'brief' only when the brief bears them out", () => {
    const brief = "Measures soil moisture every 10 minutes and reports to a phone app.";
    expect(briefStates("sensing", "Soil moisture every 10 minutes", brief)).toBe(true);
    expect(briefStates("interval", "every 15 minutes", brief)).toBe(false);
    expect(briefStates("display", "OLED screen shows the temperature", brief)).toBe(false);
  });
});
