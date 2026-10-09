import { describe, expect, it } from "vitest";

import { parseReviewBody, REVIEW_BODY_MAX_BYTES } from "./form";

const FORM = "application/x-www-form-urlencoded";

describe("parseReviewBody", () => {
  it("reads a url-encoded form", () => {
    const raw = "order=o1&score=4&l=ar&t=tok&comment=" + encodeURIComponent("خدمة ممتازة");
    expect(parseReviewBody(FORM, raw)).toEqual({
      order: "o1",
      score: "4",
      comment: "خدمة ممتازة",
      locale: "ar",
      token: "tok",
    });
  });

  it("reads JSON, accepting a numeric score", () => {
    const raw = JSON.stringify({ order: "o1", score: 5, comment: "Nice", l: "en", t: "tok" });
    expect(parseReviewBody("application/json; charset=utf-8", raw)).toEqual({
      order: "o1",
      score: "5",
      comment: "Nice",
      locale: "en",
      token: "tok",
    });
  });

  it("leaves an absent comment as null (keep) and defaults the locale to en", () => {
    expect(parseReviewBody(FORM, "order=o1&t=x")).toMatchObject({ comment: null, score: null, locale: "en" });
  });

  it("rejects bad JSON, non-objects and oversized bodies", () => {
    expect(parseReviewBody("application/json", "{nope")).toBeNull();
    expect(parseReviewBody("application/json", "[1]")).toBeNull();
    expect(parseReviewBody("application/json", "null")).toBeNull();
    expect(parseReviewBody(FORM, "comment=" + "a".repeat(REVIEW_BODY_MAX_BYTES))).toBeNull();
  });
});
