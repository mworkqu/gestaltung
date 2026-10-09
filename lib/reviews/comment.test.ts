import { describe, expect, it } from "vitest";

import { hasLink, normalizeComment, REVIEW_COMMENT_MAX, validateComment } from "./comment";

describe("normalizeComment", () => {
  it("trims and collapses whitespace and newlines", () => {
    expect(normalizeComment("  great \n\n  service\t today  ")).toBe("great service today");
  });
});

describe("hasLink", () => {
  it.each([
    "see http://x.com",
    "go to HTTPS://example.org/a",
    "visit www.shop",
    "WWW.shop.qa",
    "buy at x.com",
    "check x.qa now",
    "bit.ly/abc",
    "mail me a@b.co",
    "هذا الموقع x.com رائع",
  ])("rejects %s", (text) => expect(hasLink(text)).toBe(true));

  it.each([
    "Fast delivery, great quality.",
    "great.Fast delivery",
    "5.5 mm shaft fits well",
    "Took 2.5 days. Thanks",
    "خدمة ممتازة وتوصيل سريع",
    "x.comfortable is not a link",
    "",
  ])("accepts %s", (text) => expect(hasLink(text)).toBe(false));
});

describe("validateComment", () => {
  it("returns the cleaned comment", () => {
    expect(validateComment("  Lovely   parts \n")).toEqual({ ok: true, comment: "Lovely parts" });
  });

  it("treats empty and non-string input as an empty comment", () => {
    expect(validateComment("   ")).toEqual({ ok: true, comment: "" });
    expect(validateComment(undefined)).toEqual({ ok: true, comment: "" });
  });

  it("allows exactly 280 characters and rejects 281", () => {
    expect(validateComment("a".repeat(REVIEW_COMMENT_MAX))).toEqual({ ok: true, comment: "a".repeat(280) });
    expect(validateComment("a".repeat(REVIEW_COMMENT_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts length after collapsing whitespace", () => {
    const spaced = "a" + " ".repeat(500) + "b";
    expect(validateComment(spaced)).toEqual({ ok: true, comment: "a b" });
  });

  it("rejects links", () => {
    expect(validateComment("buy at x.com")).toEqual({ ok: false, reason: "link" });
    expect(validateComment("https://evil.example")).toEqual({ ok: false, reason: "link" });
  });
});
