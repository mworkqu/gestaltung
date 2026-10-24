import { describe, expect, it } from "vitest";

import { normalizeText as searchNormalize } from "@/lib/store/search";
import { normalizeText, tokenize } from "@/lib/text/normalize";

const SAMPLES = [
  "",
  "Plain ASCII 123",
  "Café Crème Brûlée",
  "Ångström ÀÉÎÕÜ",
  "الحَسَّاس ـ مُحَرِّك",
  "أحمد إبراهيم آمنة ٱسم",
  "مدرسة ملعب مكتبة",
  "على فتى",
  "٠١٢٣٤٥٦٧٨٩ 0123456789",
  "ESP32-WROOM (4MB) Ａｂｃ ＡＢＣ",
  "ﬁne ﬂow",
];

describe("normalizeText", () => {
  it("is identical to lib/store/search.ts normalizeText", () => {
    for (const s of SAMPLES) expect(normalizeText(s)).toBe(searchNormalize(s));
  });

  it("folds accents, Arabic forms and digits", () => {
    expect(normalizeText("Café")).toBe("cafe");
    expect(normalizeText("أحمد")).toBe("احمد");
    expect(normalizeText("مدرسة")).toBe("مدرسه");
    expect(normalizeText("على")).toBe("علي");
    expect(normalizeText("الحَسَّاس")).toBe("الحساس");
    expect(normalizeText("٠١٢٣")).toBe("0123");
    expect(normalizeText("ＡＢＣ")).toBe("abc");
  });
});

describe("tokenize", () => {
  it("splits into normalised words in order, keeping duplicates", () => {
    expect(tokenize("Servo Motor, SERVO 9g!")).toEqual(["servo", "motor", "servo", "9g"]);
    expect(tokenize("حساس الحرارة ٢٠٠")).toEqual(["حساس", "الحراره", "200"]);
  });

  it("returns [] for empty or symbol-only text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(" -- !! ")).toEqual([]);
  });

  it("drops stop words, matching after normalisation", () => {
    expect(tokenize("the Motor for a Robot", ["the", "FOR", "a"])).toEqual(["motor", "robot"]);
    expect(tokenize("مدرسة المدرسة", ["مدرسة"])).toEqual(["المدرسه"]);
    expect(tokenize("a b", new Set(["a"]))).toEqual(["b"]);
  });
});
