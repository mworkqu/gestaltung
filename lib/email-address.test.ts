import { describe, expect, it } from "vitest";

import { isEmailString, isPlausibleEmail } from "@/lib/email-address";
import { isPlausibleEmail as shippingVariant } from "@/lib/store/shipping";

const CASES: (string | null | undefined)[] = [
  "a@b.co",
  "  a@b.co  ",
  "first.last+tag@sub.example.com",
  "عربي@مثال.قطر",
  "a@b",
  "a@b.",
  "@b.co",
  "a@.co",
  "a b@c.de",
  "a@b@c.de",
  "a@b .co",
  "",
  "   ",
  null,
  undefined,
];

describe("isPlausibleEmail", () => {
  it("accepts and rejects the expected shapes", () => {
    expect(isPlausibleEmail("a@b.co")).toBe(true);
    expect(isPlausibleEmail("  a@b.co  ")).toBe(true);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a b@c.de")).toBe(false);
    expect(isPlausibleEmail(null)).toBe(false);
    expect(isPlausibleEmail(undefined)).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });

  it("lib/store/shipping.ts re-exports the same function", () => {
    expect(shippingVariant).toBe(isPlausibleEmail);
  });

  it("isEmailString agrees with it on every case", () => {
    for (const c of CASES) expect(isEmailString(c)).toBe(isPlausibleEmail(c));
  });
});

describe("isEmailString", () => {
  it("is false for non-strings", () => {
    for (const v of [1, {}, [], true, Symbol.iterator]) expect(isEmailString(v)).toBe(false);
  });

  it("narrows unknown to string", () => {
    const v: unknown = "a@b.co";
    if (isEmailString(v)) expect(v.toUpperCase()).toBe("A@B.CO");
  });
});
