import { describe, expect, it } from "vitest";

import { gapKey } from "./gap-key";

describe("gapKey", () => {
  it("puts every resistor in one row, whatever the value or plural", () => {
    expect(gapKey("Resistors")).toBe("resistor");
    expect(gapKey("resistor 220 Ω")).toBe("resistor");
    expect(gapKey("220ohm resistor")).toBe("resistor");
    expect(gapKey("10k resistor")).toBe("resistor");
  });
  it("keeps different parts apart", () => {
    expect(gapKey("M3 screws")).toBe("m3 screw");
    expect(gapKey("Soil moisture sensor")).toBe("soil moisture sensor");
    expect(gapKey("Batteries")).toBe("battery");
  });
});
