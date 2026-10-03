import { describe, expect, it } from "vitest";

import { categoriesForArabicTerm, categoryLabel } from "./category-label";
import { STORE_CATEGORIES } from "./store-categories";

describe("Arabic category labels", () => {
  it("labels the nine store categories with the owner's wording (C5)", () => {
    expect(STORE_CATEGORIES.map((c) => categoryLabel(c, "ar"))).toEqual([
      "لوحات ومتحكمات دقيقة",
      "مستشعرات",
      "وحدات",
      "رقائق ودوائر متكاملة",
      "الطاقة",
      "محركات وقطع ميكانيكية",
      "كابلات وموصلات",
      "أدوات وملحقات",
      "الطباعة ثلاثية الأبعاد",
    ]);
    for (const c of STORE_CATEGORIES) expect(categoryLabel(c, "en")).toBe(c);
  });

  it("still labels the older source categories (admin, rows before 0048)", () => {
    expect(categoryLabel("Kits", "ar")).toBe("المجموعات");
    expect(categoryLabel("3D printers", "ar")).toBe("طابعات ثلاثية الأبعاد");
    expect(categoryLabel("Brand new", "ar")).toBe("Brand new");
  });

  it("search finds the category by the new word and by the older words", () => {
    for (const w of ["مستشعرات", "المستشعرات", "مستشعر", "حساسات", "حساس"]) {
      expect(categoriesForArabicTerm(w)).toContain("Sensors");
    }
    for (const w of ["مجموعات", "أطقم", "طقم"]) {
      expect(categoriesForArabicTerm(w)).toContain("Kits");
    }
  });

  it("old Arabic words land on the new categories", () => {
    for (const w of ["متحكمات", "المتحكمات الدقيقة", "متحكم"]) {
      expect(categoriesForArabicTerm(w)).toContain("Boards and microcontrollers");
    }
    expect(categoriesForArabicTerm("متحكمات")).toContain("Microcontrollers");
    for (const w of ["طابعة", "طابعات", "خيوط", "طباعة"]) {
      expect(categoriesForArabicTerm(w)).toContain("3D printing");
    }
    expect(categoriesForArabicTerm("الوحدات")).toContain("Modules");
    expect(categoriesForArabicTerm("المحركات")).toContain("Motors and mechanical");
    expect(categoriesForArabicTerm("كابلات")).toContain("Cables and connectors");
    expect(categoriesForArabicTerm("أدوات")).toContain("Tools and accessories");
    expect(categoriesForArabicTerm("رقائق")).toContain("Chips and ICs");
  });

  it("ignores short or non-Arabic terms", () => {
    expect(categoriesForArabicTerm("حس")).toEqual([]);
    expect(categoriesForArabicTerm("sensor")).toEqual([]);
  });
});
