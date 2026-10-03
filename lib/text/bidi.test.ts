import { describe, expect, it } from "vitest";

import { hasArabic, splitBidiRuns } from "./bidi";

const join = (runs: { text: string }[]) => runs.map((r) => r.text).join("");
const ltr = (text: string) => splitBidiRuns(text).filter((r) => r.ltr).map((r) => r.text);

describe("splitBidiRuns", () => {
  it("isolates a Latin token inside Arabic text", () => {
    const runs = splitBidiRuns("لوحة ESP32 للتطوير");
    expect(runs).toEqual([
      { text: "لوحة ", ltr: false },
      { text: "ESP32", ltr: true },
      { text: " للتطوير", ltr: false },
    ]);
  });

  it("splits an Arabic conjunction و attached to a Latin word", () => {
    expect(splitBidiRuns("واي فاي وBluetooth")).toEqual([
      { text: "واي فاي و", ltr: false },
      { text: "Bluetooth", ltr: true },
    ]);
    expect(ltr("وBluetooth")).toEqual(["Bluetooth"]);
  });

  it("keeps part numbers with hyphens, dots and slashes in one run", () => {
    expect(ltr("وحدة ESP32-S3-WROOM-1 جديدة")).toEqual(["ESP32-S3-WROOM-1"]);
    expect(ltr("مستشعر DHT22/AM2302 رقمي")).toEqual(["DHT22/AM2302"]);
    expect(ltr("مضخة v1.2.3 صغيرة")).toEqual(["v1.2.3"]);
  });

  it("keeps several Latin words separated by spaces together", () => {
    expect(ltr("لوحة Arduino Uno R3 الأصلية")).toEqual(["Arduino Uno R3"]);
  });

  it("does not swallow a sentence-final dot or a lone dash", () => {
    expect(splitBidiRuns("يدعم Bluetooth. جيد")).toEqual([
      { text: "يدعم ", ltr: false },
      { text: "Bluetooth", ltr: true },
      { text: ". جيد", ltr: false },
    ]);
    expect(ltr("ESP32 - لوحة")).toEqual(["ESP32"]);
  });

  it("returns a pure Latin string as one ltr run", () => {
    expect(splitBidiRuns("ESP32-S3 DevKitC")).toEqual([{ text: "ESP32-S3 DevKitC", ltr: true }]);
  });

  it("returns pure Arabic as one non-ltr run", () => {
    expect(splitBidiRuns("لوحة تطوير")).toEqual([{ text: "لوحة تطوير", ltr: false }]);
  });

  it("isolates numbers with units", () => {
    expect(ltr("مصدر طاقة 5V لوحة")).toEqual(["5V"]);
    expect(ltr("برغي 10mm من الستانلس")).toEqual(["10mm"]);
    expect(ltr("شاشة 20×4 حرفًا")).toEqual(["20×4"]);
    expect(ltr("بطارية 3.7V 1000mAh")).toEqual(["3.7V 1000mAh"]);
  });

  it("returns [] for an empty string", () => {
    expect(splitBidiRuns("")).toEqual([]);
  });

  it("never loses or reorders characters", () => {
    for (const s of ["وBluetooth و ESP32-S3.", "  ", "A", "لوحة (ESP32) 5V!", "x-"]) {
      expect(join(splitBidiRuns(s))).toBe(s);
    }
  });
});

describe("hasArabic", () => {
  it("detects Arabic letters only", () => {
    expect(hasArabic("لوحة ESP32")).toBe(true);
    expect(hasArabic("ESP32-S3")).toBe(false);
    expect(hasArabic("")).toBe(false);
  });
});
