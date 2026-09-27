import { describe, expect, it } from "vitest";

import { detectClass, fillMissing, parametersToAttributes, siValue } from "./spec-map";

describe("siValue", () => {
  it("reads SI prefixes and units", () => {
    expect(siValue("200mA", /A/)).toBe(0.2);
    expect(siValue("100 V", /V/)).toBe(100);
    expect(siValue("10 kOhms", /Ω|ohm/)).toBe(10000);
    expect(siValue("100 nF", /F/)).toBe(1e-7);
    expect(siValue("0.25W, 1/4W", /W/)).toBe(0.25);
    expect(siValue("±5%", /%/)).toBe(5);
    expect(siValue("", /V/)).toBeNull();
  });
});

describe("detectClass", () => {
  it("picks a class from category and description", () => {
    expect(detectClass("Diodes - Rectifiers - Single Diode 100 V 200mA")).toBe("diode");
    expect(detectClass("Through Hole Resistors")).toBe("resistor");
    expect(detectClass("Thermistors - NTC")).toBeNull();
    expect(detectClass("Ceramic Capacitors")).toBe("capacitor");
  });
});

describe("parametersToAttributes", () => {
  it("maps DigiKey's 1N4148 to a signal diode", () => {
    const params = [
      { name: "Technology", value: "Standard" },
      { name: "Voltage - DC Reverse (Vr) (Max)", value: "100 V" },
      { name: "Current - Average Rectified (Io)", value: "200mA" },
      { name: "Speed", value: "Small Signal =< 200mA (Io), Any Speed" },
      { name: "Mounting Type", value: "Through Hole" },
    ];
    expect(parametersToAttributes(params, { category: "Single Diodes", description: "Diode 100 V 200mA Through Hole DO-35" })).toEqual({
      class: "diode",
      diode_type: "signal",
      voltage_v: 100,
      current_a: 0.2,
      package: "through_hole",
    });
  });
  it("maps a resistor", () => {
    const params = [
      { name: "Resistance", value: "10 kOhms" },
      { name: "Tolerance", value: "±5%" },
      { name: "Power (Watts)", value: "0.25W, 1/4W" },
      { name: "Mounting Type", value: "Through Hole" },
    ];
    expect(parametersToAttributes(params, { category: "Through Hole Resistors" })).toEqual({
      class: "resistor",
      resistance_ohm: 10000,
      tolerance_pct: 5,
      power_w: 0.25,
      package: "through_hole",
    });
  });
  it("returns nothing for a part it can't classify", () => {
    expect(parametersToAttributes([{ name: "Resistance", value: "10k" }], { category: "Thermistors" })).toEqual({});
  });
});

describe("fillMissing", () => {
  it("never overwrites what the owner entered, and ignores a different class", () => {
    expect(fillMissing({ class: "diode", voltage_v: 75 }, { class: "diode", voltage_v: 100, current_a: 0.2 })).toEqual({
      class: "diode",
      voltage_v: 75,
      current_a: 0.2,
    });
    expect(fillMissing({ class: "resistor" }, { class: "diode", voltage_v: 100 })).toEqual({ class: "resistor" });
  });
});
