import { describe, expect, it } from "vitest";

import {
  countByStatus,
  displayName,
  formatReviewDate,
  parseAdminReviews,
  parseApprovedReviews,
  parseReviewCount,
  pickHomeReviews,
  shouldShowHomeStrip,
  type ApprovedReview,
} from "./reviews";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  score: 5,
  comment: "Lovely",
  first_name: "Sara",
  locale: "en",
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

describe("shouldShowHomeStrip", () => {
  it("needs three approved reviews", () => {
    expect(shouldShowHomeStrip(0)).toBe(false);
    expect(shouldShowHomeStrip(2)).toBe(false);
    expect(shouldShowHomeStrip(3)).toBe(true);
    expect(shouldShowHomeStrip(40)).toBe(true);
    expect(shouldShowHomeStrip(NaN)).toBe(false);
  });
});

describe("displayName", () => {
  it("uses the first name, else the anonymous copy", () => {
    expect(displayName("Sara", "A customer in Qatar")).toBe("Sara");
    expect(displayName("  Sara ", "A customer in Qatar")).toBe("Sara");
    expect(displayName(null, "A customer in Qatar")).toBe("A customer in Qatar");
    expect(displayName("   ", "A customer in Qatar")).toBe("A customer in Qatar");
    expect(displayName(undefined, "x")).toBe("x");
  });
});

describe("parseApprovedReviews", () => {
  it("maps valid rows", () => {
    expect(parseApprovedReviews([row()])).toEqual([
      { id: "r1", score: 5, comment: "Lovely", firstName: "Sara", locale: "en", createdAt: "2026-10-01T10:00:00Z" },
    ]);
  });

  it("nulls missing comment and name, defaults locale to en", () => {
    const [r] = parseApprovedReviews([row({ comment: "  ", first_name: null, locale: "fr" })]);
    expect(r).toMatchObject({ comment: null, firstName: null, locale: "en" });
    expect(parseApprovedReviews([row({ locale: "ar" })])[0].locale).toBe("ar");
  });

  it("drops invalid rows and non-arrays", () => {
    expect(
      parseApprovedReviews([
        row({ id: "" }),
        row({ score: 0 }),
        row({ score: 6 }),
        row({ score: 4.5 }),
        row({ score: "5" }),
        row({ created_at: "nope" }),
        null,
        "x",
        row({ id: "ok" }),
      ]).map((r) => r.id),
    ).toEqual(["ok"]);
    expect(parseApprovedReviews(null)).toEqual([]);
    expect(parseApprovedReviews({})).toEqual([]);
  });
});

describe("parseReviewCount", () => {
  it("accepts non-negative integers and numeric strings", () => {
    expect(parseReviewCount(7)).toBe(7);
    expect(parseReviewCount("12")).toBe(12);
    expect(parseReviewCount(0)).toBe(0);
  });
  it("is 0 for anything else", () => {
    expect(parseReviewCount(null)).toBe(0);
    expect(parseReviewCount(-1)).toBe(0);
    expect(parseReviewCount(2.5)).toBe(0);
    expect(parseReviewCount("x")).toBe(0);
  });
});

describe("parseAdminReviews", () => {
  it("adds order, status and SKUs, dropping rows without them", () => {
    const rows = parseAdminReviews([
      row({ order_id: "o1", status: "pending", skus: ["A-1", "", 3, "B-2"] }),
      row({ id: "r2", order_id: "o2", status: "weird" }),
      row({ id: "r3", status: "approved" }),
      row({ id: "r4", order_id: "o4", status: "rejected" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["r1", "r4"]);
    expect(rows[0]).toMatchObject({ orderId: "o1", status: "pending", skus: ["A-1", "B-2"] });
    expect(rows[1].skus).toEqual([]);
    expect(countByStatus(rows)).toEqual({ pending: 1, approved: 0, rejected: 1 });
  });
});

describe("pickHomeReviews", () => {
  const r = (id: string, comment: string | null): ApprovedReview => ({
    id,
    score: 5,
    comment,
    firstName: null,
    locale: "en",
    createdAt: "2026-10-01T10:00:00Z",
  });

  it("puts reviews with a comment first, keeping newest-first order, at most three", () => {
    const picked = pickHomeReviews([r("a", null), r("b", "x"), r("c", null), r("d", "y"), r("e", "z"), r("f", "w")]);
    expect(picked.map((p) => p.id)).toEqual(["b", "d", "e"]);
  });

  it("falls back to score-only reviews", () => {
    expect(pickHomeReviews([r("a", null), r("b", "x"), r("c", null)]).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
});

describe("formatReviewDate", () => {
  it("uses Western digits in both languages", () => {
    expect(formatReviewDate("2026-10-09T08:00:00Z", "en")).toBe("9 Oct 2026");
    const ar = formatReviewDate("2026-10-09T08:00:00Z", "ar");
    expect(ar).toContain("2026");
    expect(ar).not.toMatch(/[٠-٩]/);
  });
  it("is empty for a bad date", () => {
    expect(formatReviewDate("nope", "en")).toBe("");
  });
});
