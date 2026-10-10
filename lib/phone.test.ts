import { describe, expect, it } from "vitest";

import { isValidPhone, normalizePhone } from "./phone";

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
