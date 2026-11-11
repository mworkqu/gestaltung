import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatFileSize, formatNumber, formatQAR } from "./format";

const D = new Date("2026-10-14T21:30:00Z"); // 00:30 on 15 Oct in Qatar (UTC+3)

describe("format", () => {
  it("formatNumber uses Western digits in both locales", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567, "ar")).not.toMatch(/[٠-٩]/);
    expect(formatNumber(1234567, "ar")).toMatch(/1.234.567/);
    expect(formatNumber(Number.NaN, "en")).toBe("");
  });

  it("formatDate uses Qatar time and Western digits", () => {
    expect(formatDate(D, "en")).toBe("October 15, 2026");
    const ar = formatDate(D, "ar");
    expect(ar).toContain("أكتوبر");
    expect(ar).toContain("15");
    expect(ar).toContain("2026");
    expect(ar).not.toMatch(/[٠-٩]/);
  });

  it("formatDate accepts strings and numbers, empty for invalid", () => {
    expect(formatDate("2026-10-14T21:30:00Z", "en")).toBe("October 15, 2026");
    expect(formatDate(D.getTime(), "en")).toBe("October 15, 2026");
    expect(formatDate("nope", "en")).toBe("");
  });

  it("formatDateTime shows 24h Qatar time", () => {
    expect(formatDateTime(D, "en")).toContain("00:30");
    expect(formatDateTime(D, "ar")).toContain("00:30");
    expect(formatDateTime(D, "ar")).not.toMatch(/[٠-٩]/);
  });

  it("formatQAR", () => {
    expect(formatQAR(1250, "en")).toBe("QAR 1,250");
    expect(formatQAR(1250, "ar")).toBe("1,250 ر.ق.");
    expect(formatQAR(99.5, "en")).toBe("QAR 99.50");
    expect(formatQAR(0, "en")).toBe("QAR 0");
  });

  it("formatFileSize", () => {
    expect(formatFileSize(0, "en")).toBe("0 B");
    expect(formatFileSize(512, "en")).toBe("512 B");
    expect(formatFileSize(1536, "en")).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024, "en")).toBe("5 MB");
    expect(formatFileSize(3 * 1024 ** 3, "ar")).toBe("3 GB");
    expect(formatFileSize(-1, "en")).toBe("");
  });
});
