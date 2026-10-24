import { describe, expect, it } from "vitest";

import { formatPrice, partImageUrl, partName } from "./format";

describe("formatPrice", () => {
  it.each([
    [0, "QAR 0.00", "0.00 ر.ق"],
    [12.5, "QAR 12.50", "12.50 ر.ق"],
    [1234.56, "QAR 1234.56", "1234.56 ر.ق"], // no thousands separator
    [-3, "QAR -3.00", "-3.00 ر.ق"],
  ])("%s", (value, en, ar) => {
    expect(formatPrice(value, "en")).toBe(en);
    expect(formatPrice(value, "ar")).toBe(ar);
  });

  it("treats any non-ar locale as English", () => {
    expect(formatPrice(1, "fr")).toBe("QAR 1.00");
  });

  it("rounds to two decimals", () => {
    expect(formatPrice(1.999, "en")).toBe("QAR 2.00");
    expect(formatPrice(1.001, "ar")).toBe("1.00 ر.ق");
  });
});

describe("partName", () => {
  const part = { name: "Resistor", name_ar: "مقاومة" };

  it("uses the Arabic name only for ar", () => {
    expect(partName(part, "ar")).toBe("مقاومة");
    expect(partName(part, "en")).toBe("Resistor");
  });

  it("falls back to the base name when the Arabic one is null or blank", () => {
    expect(partName({ name: "Resistor", name_ar: null }, "ar")).toBe("Resistor");
    expect(partName({ name: "Resistor", name_ar: "   " }, "ar")).toBe("Resistor");
  });
});

describe("partImageUrl", () => {
  const img = (image_url: string | null) => partImageUrl({ image_url });

  it("passes a plain http(s) URL through", () => {
    expect(img("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(img("  http://cdn.example.com/a.png  ")).toBe("http://cdn.example.com/a.png");
  });

  it("is null for empty, junk and non-http values", () => {
    expect(img(null)).toBeNull();
    expect(img("   ")).toBeNull();
    expect(img("[link removed]")).toBeNull();
    expect(img("photo.jpg")).toBeNull();
    expect(img("javascript:alert(1)")).toBeNull();
    expect(img("data:image/png;base64,AAAA")).toBeNull();
    expect(img("ftp://x/y.png")).toBeNull();
  });

  it("rewrites Google Drive share links to a direct-view URL", () => {
    const direct = "https://drive.google.com/uc?export=view&id=ABC123";
    expect(img("https://drive.google.com/file/d/ABC123/view?usp=sharing")).toBe(direct);
    expect(img("https://drive.google.com/open?id=ABC123")).toBe(direct);
  });

  it("leaves a Drive URL with no id untouched", () => {
    expect(img("https://drive.google.com/drive/folders")).toBe("https://drive.google.com/drive/folders");
  });
});
