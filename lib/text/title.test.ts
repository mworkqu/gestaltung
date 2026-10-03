import { describe, expect, it } from "vitest";

import { truncateAtWord } from "./title";

describe("truncateAtWord", () => {
  it("leaves short text alone", () => {
    expect(truncateAtWord("لوحة ESP32", 80)).toBe("لوحة ESP32");
  });

  it("cuts at a word boundary and adds an ellipsis", () => {
    const text = "لوحة تطوير متكاملة تدعم واي فاي وبلوتوث مع شاشة ملونة ومستشعرات متعددة للمشاريع الصغيرة والكبيرة";
    const out = truncateAtWord(text, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
    expect(text.charAt(out.length - 1)).toBe(" ");
  });

  it("defaults to 80 characters", () => {
    const text = "كلمة ".repeat(40).trim();
    const out = truncateAtWord(text);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith("…")).toBe(true);
  });

  it("cuts a single long word at the limit", () => {
    expect(truncateAtWord("a".repeat(100), 10)).toBe("aaaaaaaaaa…");
  });

  it("drops a trailing joiner before the ellipsis", () => {
    expect(truncateAtWord("ESP32-S3 DevKit - extra words here", 17)).toBe("ESP32-S3 DevKit…");
  });
});
