import { describe, expect, it } from "vitest";

import {
  CONFIRM_TYPES,
  OTP_VALID_HOURS,
  isResetType,
  parseConfirmType,
  parseOtpCode,
  parseTokenHash,
  passwordSchema,
} from "./reset-token";

// What the reset and confirm pages read out of the emailed link. Nothing here
// touches Supabase: a bad value must become null on the page, long before a
// server action would spend a token.

describe("parseTokenHash", () => {
  it("takes a plain hash and a pkce_ one", () => {
    const sha224 = "a".repeat(56);
    expect(parseTokenHash(sha224)).toBe(sha224);
    expect(parseTokenHash(`pkce_${sha224}`)).toBe(`pkce_${sha224}`);
    expect(parseTokenHash(" 0123456789abcdef ")).toBe("0123456789abcdef");
  });

  it("is null when the link carries no hash", () => {
    expect(parseTokenHash(undefined)).toBeNull();
    expect(parseTokenHash(null)).toBeNull();
    expect(parseTokenHash("")).toBeNull();
    // A repeated query parameter arrives as an array.
    expect(parseTokenHash(["abc", "def"])).toBeNull();
  });

  it("is null when the hash is malformed", () => {
    expect(parseTokenHash("tooshort")).toBeNull(); // under 16 characters
    expect(parseTokenHash(`${"a".repeat(50)}+/=`)).toBeNull(); // not URL-safe
    expect(parseTokenHash(`${"a".repeat(50)} ${"b".repeat(20)}`)).toBeNull();
    expect(parseTokenHash("x".repeat(513))).toBeNull(); // cap
  });
});

describe("parseOtpCode", () => {
  it("takes the six digits, pasted with or without spaces", () => {
    expect(parseOtpCode("123456")).toBe("123456");
    expect(parseOtpCode("123 456")).toBe("123456");
    expect(parseOtpCode(" 0 0 0 0 0 0 ")).toBe("000000");
  });

  it("is null when the code is missing, short, long or not digits", () => {
    expect(parseOtpCode(undefined)).toBeNull();
    expect(parseOtpCode("")).toBeNull();
    expect(parseOtpCode("12345")).toBeNull();
    expect(parseOtpCode("1234567")).toBeNull();
    expect(parseOtpCode("12345a")).toBeNull();
    // Arabic-Indic digits are not what the template prints (Western digits rule).
    expect(parseOtpCode("١٢٣٤٥٦")).toBeNull();
    expect(parseOtpCode(123456)).toBeNull();
  });
});

describe("parseConfirmType", () => {
  it("takes only the two types we send", () => {
    expect(parseConfirmType("signup")).toBe("signup");
    expect(parseConfirmType("email_change")).toBe("email_change");
    expect(CONFIRM_TYPES).toEqual(["signup", "email_change"]);
  });

  it("refuses any other type", () => {
    // recovery belongs to /reset-password, never to /confirm-email.
    expect(parseConfirmType("recovery")).toBeNull();
    expect(parseConfirmType("magiclink")).toBeNull();
    expect(parseConfirmType("invite")).toBeNull();
    expect(parseConfirmType(undefined)).toBeNull();
    expect(parseConfirmType(["signup"])).toBeNull();
  });
});

describe("isResetType", () => {
  it("is true only for recovery", () => {
    expect(isResetType("recovery")).toBe(true);
    expect(isResetType("signup")).toBe(false);
    expect(isResetType(undefined)).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("matches Supabase's own limits", () => {
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(true);
    expect(passwordSchema.safeParse("abcdefg").success).toBe(false);
    expect(passwordSchema.safeParse("abcdef").success).toBe(false); // the old 6-character minimum
    expect(passwordSchema.safeParse("x".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });
});

it("says 3 hours, the value the owner sets in Supabase", () => {
  // docs/AUTH_EMAILS.md step 3 (10800 s) and the four templates print this.
  expect(OTP_VALID_HOURS).toBe(3);
});
