import { describe, expect, it } from "vitest";

import { asLocale, intlTag, isRtl, pick } from "@/lib/locale";

describe("asLocale", () => {
  it("returns ar only for exactly 'ar'", () => {
    expect(asLocale("ar")).toBe("ar");
    for (const v of ["en", "AR", "ar-QA", " ar", "", "fr", undefined, null, 1, {}, ["ar"]]) {
      expect(asLocale(v)).toBe("en");
    }
  });
});

describe("isRtl / intlTag / pick", () => {
  it("isRtl is true for Arabic only", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });

  it("intlTag returns the two tags the app uses", () => {
    expect(intlTag("ar")).toBe("ar-QA-u-nu-latn");
    expect(intlTag("en")).toBe("en-GB");
    // Western digits for Arabic
    expect(new Intl.NumberFormat(intlTag("ar")).format(1234)).toMatch(/^1.?234$/);
  });

  it("pick selects by locale and keeps the value type", () => {
    expect(pick("en", { en: "Save", ar: "حفظ" })).toBe("Save");
    expect(pick("ar", { en: "Save", ar: "حفظ" })).toBe("حفظ");
    const n: number = pick("ar", { en: 1, ar: 2 });
    expect(n).toBe(2);
  });
});
