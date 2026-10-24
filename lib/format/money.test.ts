import { describe, expect, it } from "vitest";

import { CREDIT_QAR as CREDIT_QAR_SOURCE } from "@/lib/credits/constants";
import { CREDIT_QAR, formatQar, round2 } from "@/lib/format/money";
import { formatPrice } from "@/lib/parts/format";

describe("formatQar", () => {
  it("matches the exact strings of lib/parts/format.ts formatPrice", () => {
    expect(formatQar(12.5, "en")).toBe("QAR 12.50");
    expect(formatQar(12.5, "ar")).toBe("12.50 ر.ق");
    for (const n of [0, 1, 0.005, 1.005, 12.345, 999.999, 1234567.891, -3.2, 1e-7]) {
      for (const loc of ["en", "ar", "fr", ""]) {
        expect(formatQar(n, loc)).toBe(formatPrice(n, loc));
      }
    }
  });

  it("uses Western digits for Arabic", () => {
    expect(formatQar(1234.5, "ar")).toBe("1234.50 ر.ق");
  });

  it("supports decimals and symbol options", () => {
    expect(formatQar(12.5, "en", { decimals: 0 })).toBe("QAR 13");
    expect(formatQar(12.5, "ar", { decimals: 0 })).toBe("13 ر.ق");
    expect(formatQar(12.5, "en", { symbol: false })).toBe("12.50");
    expect(formatQar(12.5, "ar", { symbol: false, decimals: 1 })).toBe("12.5");
  });
});

describe("round2", () => {
  it("rounds to two decimals like Math.round(n*100)/100", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
    expect(round2(10)).toBe(10);
    expect(round2(-1.236)).toBe(-1.24);
    for (const n of [0.1 + 0.2, 2.675, 1.005, 19.999, 1e6 / 3]) {
      expect(round2(n)).toBe(Math.round(n * 100) / 100);
    }
  });
});

describe("CREDIT_QAR", () => {
  it("is the credits constant", () => {
    expect(CREDIT_QAR).toBe(CREDIT_QAR_SOURCE);
    expect(CREDIT_QAR).toBe(20);
  });
});
