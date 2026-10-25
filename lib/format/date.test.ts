import { describe, expect, it } from "vitest";

import { addDays, DAY_MS, dayFormatter, timeFormatter } from "@/lib/format/date";

describe("addDays", () => {
  it("adds and subtracts calendar days", () => {
    expect(addDays("2026-03-05", 1)).toBe("2026-03-06");
    expect(addDays("2026-03-05", 0)).toBe("2026-03-05");
    expect(addDays("2026-03-05", -5)).toBe("2026-02-28");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("is not affected by DST (UTC arithmetic)", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("DAY_MS", () => {
  it("is 24 hours", () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("dayFormatter / timeFormatter", () => {
  // 2026-03-05T22:30:00Z is already 6 March at 01:30 in Qatar (UTC+3, no DST).
  const d = new Date("2026-03-05T22:30:00Z");

  it("formats in Asia/Qatar, not UTC", () => {
    expect(dayFormatter("en").format(d)).toBe("06 Mar 2026");
    expect(timeFormatter("en").format(d)).toContain("06 Mar");
    expect(timeFormatter("en").format(d)).toContain("01:30");
    expect(dayFormatter("en").resolvedOptions().timeZone).toBe("Asia/Qatar");
  });

  it("uses Western digits in Arabic", () => {
    expect(dayFormatter("ar").format(d)).toMatch(/06/);
    expect(dayFormatter("ar").format(d)).toMatch(/2026/);
    expect(timeFormatter("ar").format(d)).toMatch(/01.30/);
  });

  it("returns the same instance per locale", () => {
    expect(dayFormatter("en")).toBe(dayFormatter("en"));
    expect(timeFormatter("ar")).toBe(timeFormatter("ar"));
    expect(dayFormatter("en")).not.toBe(dayFormatter("ar"));
  });
});
