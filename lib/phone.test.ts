import { describe, expect, it } from "vitest";

import { isObviousFakeNumber, isValidPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("writes Qatar numbers as +974 and eight digits", () => {
    expect(normalizePhone("6656 7410")).toBe("+97466567410");
    expect(normalizePhone("0097466567410")).toBe("+97466567410");
  });
});

describe("isValidPhone", () => {
  it("accepts Qatar numbers however they're typed, and international ones with +", () => {
    for (const ok of ["66567410", "+974 6656 7410", "0097466567410", "+44 7700 900123"]) expect(isValidPhone(ok)).toBe(true);
  });
  it("rejects short, empty or letter input", () => {
    for (const bad of ["", "1234", "abc", "+974 1234", "0000 0000 0000 0000 0"]) expect(isValidPhone(bad)).toBe(false);
  });
  it("W2: accepts a Qatar mobile starting 3, 5, 6 or 7", () => {
    for (const ok of ["+974 5555 1234", "55551234", "3312 4567", "+97466567410", "0097470123456", "7012 3456"])
      expect(isValidPhone(ok), ok).toBe(true);
  });
  it("W2: rejects junk: all one digit, running sequences, landlines, wrong first digit", () => {
    for (const bad of [
      "00000000",
      "11111111",
      "12345678",
      "87654321",
      "55555555",
      "+974 3333 3333",
      "34567890",
      "76543210",
      "+974 4444 1234", // landline: no WhatsApp
      "+974 1234 5670",
      "+974 2345 6781",
      "+974 8123 4567",
      "+974 9123 4567",
    ])
      expect(isValidPhone(bad), bad).toBe(false);
  });
  it("W2: foreign E.164 numbers are unchanged", () => {
    expect(isValidPhone("+44 7700 900123")).toBe(true);
    expect(isValidPhone("+1 202 555 0123")).toBe(true);
  });
});

describe("isObviousFakeNumber", () => {
  it("spots repeats and sequences, not real numbers", () => {
    for (const fake of ["55555555", "12345678", "87654321", "56789012", "32109876"]) expect(isObviousFakeNumber(fake), fake).toBe(true);
    for (const real of ["55551234", "66567410", "33124567", "70707070"]) expect(isObviousFakeNumber(real), real).toBe(false);
  });
});

import { formatPhoneDisplay } from "./phone";

describe("formatPhoneDisplay", () => {
  it("shows Qatar numbers as +974 XXXX XXXX however they were stored", () => {
    for (const raw of ["+97466567410", "66567410", "+974 6656 7410", "0097466567410", "+974 974 66567410", "+97497466567410"]) {
      expect(formatPhoneDisplay(raw)).toBe("+974 6656 7410");
    }
  });
  it("leaves foreign and unreadable numbers as typed, and is null-safe", () => {
    expect(formatPhoneDisplay("+44 7700 900123")).toBe("+44 7700 900123");
    expect(formatPhoneDisplay("call me")).toBe("call me");
    expect(formatPhoneDisplay(null)).toBe("");
    expect(formatPhoneDisplay("  ")).toBe("");
  });
});

describe("normalizePhone on real stored shapes", () => {
  it("collapses a doubled country code", () => {
    expect(normalizePhone("+97497466567410")).toBe("+97466567410");
  });
});
