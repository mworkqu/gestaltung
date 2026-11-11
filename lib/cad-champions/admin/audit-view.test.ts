import { describe, expect, it } from "vitest";

import { actionLikePattern, auditFilterParams, dateRangeBounds, diffAudit, formatAuditValue, pageCount, parseAuditFilters, rangeForPage } from "./audit-view";

describe("parseAuditFilters", () => {
  it("defaults", () => {
    expect(parseAuditFilters({})).toEqual({ action: "", entity: "", actor: "", from: "", to: "", page: 1 });
  });
  it("cleans every field", () => {
    const f = parseAuditFilters({
      action: " payment.% ",
      entity: "cc_plans",
      actor: "00000000-0000-4000-8000-0000000000AA",
      from: "2026-10-01",
      to: "2026-02-30",
      page: "3",
    });
    expect(f).toEqual({ action: "payment.", entity: "cc_plans", actor: "00000000-0000-4000-8000-0000000000aa", from: "2026-10-01", to: "", page: 3 });
    expect(parseAuditFilters({ actor: "nope", page: "-2" })).toMatchObject({ actor: "", page: 1 });
  });
  it("keeps only non-default params for links", () => {
    expect(auditFilterParams(parseAuditFilters({ action: "plan.", page: "4" }))).toEqual({ action: "plan." });
  });
});

describe("query helpers", () => {
  it("escapes LIKE wildcards in a prefix", () => {
    expect(actionLikePattern("plan.")).toBe("plan.%");
    expect(actionLikePattern("a_b%c")).toBe("a\\_b\\%c%");
  });
  it("turns a Qatar day range into UTC bounds (end exclusive)", () => {
    expect(dateRangeBounds("2026-10-01", "2026-10-02")).toEqual({ gte: "2026-09-30T21:00:00.000Z", lt: "2026-10-02T21:00:00.000Z" });
    expect(dateRangeBounds("", "")).toEqual({ gte: null, lt: null });
  });
  it("computes the row range and page count", () => {
    expect(rangeForPage(1)).toEqual({ from: 0, to: 49 });
    expect(rangeForPage(3, 10)).toEqual({ from: 20, to: 29 });
    expect(pageCount(0)).toBe(1);
    expect(pageCount(101)).toBe(3);
  });
});

describe("diffAudit", () => {
  it("lists only the changed keys, sorted", () => {
    expect(diffAudit({ price_qar: 100, name: "A", same: 1 }, { price_qar: 120, name: "A", same: 1, extra: true })).toEqual([
      { key: "extra", before: null, after: "true" },
      { key: "price_qar", before: "100", after: "120" },
    ]);
  });
  it("treats a missing side as empty and compares nested values", () => {
    expect(diffAudit(null, { a: { x: 1 } })).toEqual([{ key: "a", before: null, after: '{"x":1}' }]);
    expect(diffAudit({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
  });
  it("falls back (null) when a side is not an object", () => {
    expect(diffAudit([1], { a: 1 })).toBeNull();
    expect(diffAudit("x", null)).toBeNull();
  });
  it("clips long values", () => {
    expect(formatAuditValue("x".repeat(300)).length).toBe(160);
    expect(formatAuditValue(null)).toBe("null");
  });
});
