import { describe, expect, it } from "vitest";

import { categoriesForArabicTerm, categoryLabel } from "./category-label";

describe("Arabic category labels", () => {
  it("uses مستشعرات for Sensors and مجموعات for Kits", () => {
    expect(categoryLabel("Sensors", "ar")).toBe("المستشعرات");
    expect(categoryLabel("Kits", "ar")).toBe("المجموعات");
  });

  it("search finds the category by the new word and by the older words", () => {
    for (const w of ["مستشعرات", "المستشعرات", "مستشعر", "حساسات", "حساس"]) {
      expect(categoriesForArabicTerm(w)).toContain("Sensors");
    }
    for (const w of ["مجموعات", "أطقم", "طقم"]) {
      expect(categoriesForArabicTerm(w)).toContain("Kits");
    }
  });
});
