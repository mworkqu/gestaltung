import { describe, expect, it } from "vitest";

import { parseScore, ratingSecret, ratingToken, ratingUrl, ratingUrls, verifyRatingToken } from "./rating";

const ORDER = "1a2b3c4d-0000-4000-8000-000000000001";
const OTHER = "1a2b3c4d-0000-4000-8000-000000000002";

describe("rating token (HMAC of the order id)", () => {
  it("is stable, 32 url-safe characters, and differs per order and per secret", () => {
    const t = ratingToken(ORDER, "s1");
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(ratingToken(ORDER, "s1")).toBe(t);
    expect(ratingToken(ORDER.toUpperCase(), "s1")).toBe(t);
    expect(ratingToken(OTHER, "s1")).not.toBe(t);
    expect(ratingToken(ORDER, "s2")).not.toBe(t);
  });

  it("verifies only the right order with the right secret", () => {
    const t = ratingToken(ORDER, "s1");
    expect(verifyRatingToken(ORDER, t, "s1")).toBe(true);
    expect(verifyRatingToken(OTHER, t, "s1")).toBe(false);
    expect(verifyRatingToken(ORDER, t, "s2")).toBe(false);
    expect(verifyRatingToken(ORDER, t.slice(1), "s1")).toBe(false);
    expect(verifyRatingToken(ORDER, t, null)).toBe(false);
    expect(verifyRatingToken("not-a-uuid", t, "s1")).toBe(false);
    expect(verifyRatingToken(ORDER, null, "s1")).toBe(false);
  });
});

describe("parseScore", () => {
  it("accepts 1-5 only", () => {
    expect(parseScore("1")).toBe(1);
    expect(parseScore(" 5 ")).toBe(5);
    expect(parseScore(3)).toBe(3);
    for (const bad of ["0", "6", "2.5", "", "x", null, undefined, 7]) expect(parseScore(bad)).toBeNull();
  });
});

describe("rating links", () => {
  it("carry order, score, locale and token", () => {
    const u = new URL(ratingUrl("https://gestaltung360.com/", ORDER, 4, "s1", "ar"));
    expect(u.pathname).toBe("/api/orders/rate");
    expect(u.searchParams.get("order")).toBe(ORDER);
    expect(u.searchParams.get("score")).toBe("4");
    expect(u.searchParams.get("l")).toBe("ar");
    expect(verifyRatingToken(ORDER, u.searchParams.get("t"), "s1")).toBe(true);
  });

  it("five links 1 → 5, none without a secret or a real id", () => {
    const urls = ratingUrls("https://x.test", ORDER, "s1", "en");
    expect(urls.map((u) => new URL(u).searchParams.get("score"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(ratingUrls("https://x.test", ORDER, null, "en")).toEqual([]);
    expect(ratingUrls("https://x.test", "abc", "s1", "en")).toEqual([]);
  });

  it("secret: ORDER_RATING_SECRET, else CRON_SECRET, else none", () => {
    expect(ratingSecret({ ORDER_RATING_SECRET: "a", CRON_SECRET: "b" })).toBe("a");
    expect(ratingSecret({ CRON_SECRET: "b" })).toBe("b");
    expect(ratingSecret({})).toBeNull();
  });
});
