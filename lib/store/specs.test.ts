import { describe, expect, it } from "vitest";

import { productSpecs, splitSpecs } from "./specs";

const voltaat = "Fast thruster.\nFeatures\n• Brushless\nSpecifications\n• Motor type: Brushless DC motor\n• Operating voltage: 7–24V DC\nLinks\n• 3D model";

describe("splitSpecs", () => {
  it("lifts the Specifications bullets out of a Voltaat description", () => {
    const r = splitSpecs(voltaat);
    expect(r.specs).toEqual([
      { name: "Motor type", value: "Brushless DC motor" },
      { name: "Operating voltage", value: "7–24V DC" },
    ]);
    expect(r.text).toContain("Features");
    expect(r.text).not.toContain("Operating voltage");
    expect(r.text).toContain("Links");
  });
  it("leaves a description without a spec section alone", () => {
    expect(splitSpecs("Just text")).toEqual({ text: "Just text", specs: [] });
  });
});

describe("productSpecs", () => {
  it("prefers the supplier's table", () => {
    const r = productSpecs({ specs: [{ name: "Voltage", value: "5V" }], description: voltaat });
    expect(r.specs).toEqual([{ name: "Voltage", value: "5V" }]);
    expect(r.text).toBe(voltaat);
  });
});
