import { describe, expect, it } from "vitest";

import { classifyCadRequest } from "./classify";

describe("classifyCadRequest", () => {
  it("calls a plain block or plate simple, in OpenSCAD", () => {
    expect(classifyCadRequest("A flat plate 80 x 40 x 3 mm")).toEqual({ tier: "simple", engine: "openscad" });
  });
  it("calls an enclosure standard", () => {
    expect(classifyCadRequest("An enclosure for an Arduino Uno").tier).toBe("standard");
  });
  it("calls gears, hinges and assemblies complex, in CadQuery", () => {
    expect(classifyCadRequest("A gearbox assembly with two gears")).toEqual({ tier: "complex", engine: "cadquery" });
    expect(classifyCadRequest("علبة مع مفصل للغطاء").tier).toBe("complex");
  });
  it("treats an empty description as simple", () => {
    expect(classifyCadRequest("").tier).toBe("simple");
  });
});
