import { describe, expect, it } from "vitest";
import { buildGrantNote, mailtoLink, parseGrantReason, pickAmount, recentUse } from "./grant-reasons";

describe("grant reasons", () => {
  it("builds the ledger note", () => {
    expect(buildGrantNote("bank_transfer", " 60 QAR ")).toBe("Bank transfer — 60 QAR");
    expect(buildGrantNote("goodwill", "")).toBe("Goodwill");
    expect(buildGrantNote("other", "")).toBe("");
    expect(buildGrantNote("other", "Contest prize")).toBe("Contest prize");
  });
  it("falls back to other for junk", () => {
    expect(parseGrantReason("goodwill")).toBe("goodwill");
    expect(parseGrantReason("nope")).toBe("other");
    expect(parseGrantReason(null)).toBe("other");
  });
  it("prefers the quick button amount", () => {
    expect(pickAmount("3", "7")).toBe(3);
    expect(pickAmount(null, "7")).toBe(7);
    expect(pickAmount("", "2.9")).toBe(2);
    expect(pickAmount(null, "abc")).toBeNaN();
  });
  it("lists the latest spends only", () => {
    const l = [
      { delta: 3, reason: "admin_grant", created_at: "2026-01-01", kind: "wiring" },
      { delta: -1, reason: "spend:a", created_at: "2026-01-02", kind: "wiring" },
      { delta: -1, reason: "spend:b", created_at: "2026-01-05", kind: "cad" },
    ];
    expect(recentUse(l, 1).map((x) => x.reason)).toEqual(["spend:b"]);
    expect(recentUse(l).length).toBe(2);
  });
  it("encodes the mailto", () => {
    expect(mailtoLink("a+b@x.com", "Hi there", "Line 1\nLine 2")).toBe("mailto:a%2Bb@x.com?subject=Hi%20there&body=Line%201%0ALine%202");
  });
});
