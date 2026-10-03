import { describe, expect, it } from "vitest";

import { arabicCountForm } from "./count";

describe("arabicCountForm", () => {
  it.each([
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [10, "few"],
    [11, "many"],
    [99, "many"],
    [100, "many"],
    [101, "many"],
    [102, "many"],
    [103, "many"],
    [107, "many"],
    [111, "many"],
  ] as const)("%i → %s", (n, form) => {
    expect(arabicCountForm(n)).toBe(form);
  });

  it("107 is `many` even though CLDR calls it `few`", () => {
    expect(new Intl.PluralRules("ar").select(107)).toBe("few");
    expect(arabicCountForm(107)).toBe("many");
  });

  it("ignores sign and fractions", () => {
    expect(arabicCountForm(-3)).toBe("few");
    expect(arabicCountForm(2.9)).toBe("two");
  });
});
