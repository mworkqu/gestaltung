import { afterEach, describe, expect, it, vi } from "vitest";

import { CC_RATE_LIMITS, ccRateLimited } from "./rate-limits";

afterEach(() => vi.restoreAllMocks());

describe("CC rate limits", () => {
  it("allows up to the limit per user, then refuses until the window passes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { limit, windowMs } = CC_RATE_LIMITS.coupon;
    const t0 = 1_000_000;
    for (let i = 0; i < limit; i++) expect(ccRateLimited("coupon", "user-a", t0 + i)).toBe(false);
    expect(ccRateLimited("coupon", "user-a", t0 + limit)).toBe(true);
    // another user has their own budget
    expect(ccRateLimited("coupon", "user-b", t0 + limit)).toBe(false);
    // a new window starts fresh
    expect(ccRateLimited("coupon", "user-a", t0 + windowMs + 1)).toBe(false);
  });

  it("keeps buckets separate", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = 5_000_000;
    for (let i = 0; i < CC_RATE_LIMITS.proof.limit; i++) ccRateLimited("proof", "user-c", t0);
    expect(ccRateLimited("proof", "user-c", t0)).toBe(true);
    expect(ccRateLimited("question", "user-c", t0)).toBe(false);
  });

  it("logs without the user id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = 9_000_000;
    for (let i = 0; i <= CC_RATE_LIMITS.upload.limit; i++) ccRateLimited("upload", "secret-user-id", t0);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret-user-id");
  });
});
