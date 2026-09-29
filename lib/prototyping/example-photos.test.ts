import { describe, expect, it } from "vitest";

import { exampleQueries } from "./example-photos";

describe("exampleQueries", () => {
  it("tries the whole function, then its distinctive words, longest first", () => {
    expect(exampleQueries("Servo motor")).toEqual(["servo motor", "servo", "motor"]);
  });
  it("skips words that would match anything", () => {
    expect(exampleQueries("Soil moisture sensor module")).toEqual(["soil moisture sensor module", "moisture", "soil"]);
  });
  it("returns nothing for an empty function", () => {
    expect(exampleQueries("  ")).toEqual([]);
  });
});
