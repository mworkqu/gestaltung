import { describe, expect, it } from "vitest";

import {
  activeOccasions,
  draftsToInput,
  emptyDraft,
  formatOccasionDate,
  isFullDate,
  isMonthDay,
  isOccasionActive,
  occasionBanner,
  occasionHref,
  occasionSearchState,
  occasionStatus,
  occasionTitle,
  parseOccasions,
  parseSkuList,
  qatarToday,
  toDrafts,
  validateOccasions,
  type Occasion,
} from "./occasions";

const base = {
  id: "science-fair",
  title_en: "Science fair season",
  title_ar: "موسم معارض العلوم",
  start: "02-01",
  end: "03-31",
  query: "arduino kit",
  skus: [] as string[],
  banner_en: "Arduino kits and sensors.",
  banner_ar: "مجموعات Arduino.",
};
const occ = (patch: Partial<Occasion> = {}): Occasion => ({ ...base, ...patch });

describe("date shapes", () => {
  it("accepts real month-days, including Feb 29", () => {
    expect(isMonthDay("02-29")).toBe(true);
    expect(isMonthDay("12-31")).toBe(true);
    expect(isMonthDay("02-30")).toBe(false);
    expect(isMonthDay("13-01")).toBe(false);
    expect(isMonthDay("00-10")).toBe(false);
    expect(isMonthDay("2-1")).toBe(false);
    expect(isMonthDay("2027-02-08")).toBe(false);
    expect(isMonthDay(null)).toBe(false);
  });
  it("accepts real calendar dates with a year", () => {
    expect(isFullDate("2027-02-08")).toBe(true);
    expect(isFullDate("2028-02-29")).toBe(true);
    expect(isFullDate("2027-02-29")).toBe(false);
    expect(isFullDate("02-08")).toBe(false);
    expect(isFullDate("1999-01-01")).toBe(false);
  });
});

describe("qatarToday", () => {
  it("uses the Doha calendar date (UTC+3)", () => {
    expect(qatarToday(new Date("2026-10-09T10:00:00Z"))).toBe("2026-10-09");
    expect(qatarToday(new Date("2026-10-09T20:59:59Z"))).toBe("2026-10-09");
    expect(qatarToday(new Date("2026-10-09T21:00:00Z"))).toBe("2026-10-10");
    expect(qatarToday(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });
});

describe("isOccasionActive", () => {
  it("repeats a month-day range every year, inclusive", () => {
    const o = occ();
    expect(isOccasionActive(o, "2026-02-01")).toBe(true);
    expect(isOccasionActive(o, "2026-03-31")).toBe(true);
    expect(isOccasionActive(o, "2031-03-15")).toBe(true);
    expect(isOccasionActive(o, "2026-01-31")).toBe(false);
    expect(isOccasionActive(o, "2026-04-01")).toBe(false);
  });

  it("handles a range that wraps the new year", () => {
    const o = occ({ start: "12-20", end: "01-05" });
    expect(isOccasionActive(o, "2026-12-20")).toBe(true);
    expect(isOccasionActive(o, "2026-12-31")).toBe(true);
    expect(isOccasionActive(o, "2027-01-01")).toBe(true);
    expect(isOccasionActive(o, "2027-01-05")).toBe(true);
    expect(isOccasionActive(o, "2027-01-06")).toBe(false);
    expect(isOccasionActive(o, "2026-12-19")).toBe(false);
    expect(isOccasionActive(o, "2026-07-01")).toBe(false);
  });

  it("a one-day month-day range is on that day only", () => {
    const o = occ({ start: "12-18", end: "12-18" });
    expect(isOccasionActive(o, "2026-12-18")).toBe(true);
    expect(isOccasionActive(o, "2026-12-17")).toBe(false);
    expect(isOccasionActive(o, "2026-12-19")).toBe(false);
  });

  it("a year-stamped range applies only to that span", () => {
    const o = occ({ start: "2027-02-08", end: "2027-03-12" });
    expect(isOccasionActive(o, "2027-02-08")).toBe(true);
    expect(isOccasionActive(o, "2027-03-12")).toBe(true);
    expect(isOccasionActive(o, "2027-02-07")).toBe(false);
    expect(isOccasionActive(o, "2027-03-13")).toBe(false);
    // The same dates in another year are off.
    expect(isOccasionActive(o, "2028-02-20")).toBe(false);
    expect(isOccasionActive(o, "2026-02-20")).toBe(false);
  });

  it("a year-stamped range may cross years", () => {
    const o = occ({ start: "2026-12-25", end: "2027-01-03" });
    expect(isOccasionActive(o, "2026-12-31")).toBe(true);
    expect(isOccasionActive(o, "2027-01-03")).toBe(true);
    expect(isOccasionActive(o, "2027-01-04")).toBe(false);
  });

  it("treats Feb 29 as a normal month-day", () => {
    const leapDay = occ({ start: "02-29", end: "02-29" });
    expect(isOccasionActive(leapDay, "2028-02-29")).toBe(true);
    expect(isOccasionActive(leapDay, "2028-02-28")).toBe(false);
    expect(isOccasionActive(leapDay, "2027-02-28")).toBe(false);
    expect(isOccasionActive(leapDay, "2027-03-01")).toBe(false);
    const feb = occ({ start: "02-20", end: "03-05" });
    expect(isOccasionActive(feb, "2028-02-29")).toBe(true);
    expect(isOccasionActive(feb, "2027-03-01")).toBe(true);
  });

  it("is off for a malformed date or mixed forms", () => {
    expect(isOccasionActive(occ(), "not-a-date")).toBe(false);
    expect(isOccasionActive(occ(), "2026-13-01")).toBe(false);
    expect(isOccasionActive(occ({ start: "02-01", end: "2027-03-12" }), "2027-02-20")).toBe(false);
  });
});

describe("activeOccasions", () => {
  const list = [
    occ({ id: "national-day", start: "12-10", end: "12-18" }),
    occ({ id: "wrap", start: "12-05", end: "01-05" }),
    occ({ id: "exam", start: "05-01", end: "06-30" }),
    occ({ id: "ramadan", start: "2027-02-08", end: "2027-03-12" }),
  ];
  it("returns only the active ones, earliest start first", () => {
    expect(activeOccasions(list, "2026-12-12").map((o) => o.id)).toEqual(["wrap", "national-day"]);
    expect(activeOccasions(list, "2027-02-20").map((o) => o.id)).toEqual(["ramadan"]);
    expect(activeOccasions(list, "2026-08-01")).toEqual([]);
  });
  it("breaks start ties by id", () => {
    const tie = [occ({ id: "b", start: "03-01", end: "03-31" }), occ({ id: "a", start: "03-01", end: "03-31" })];
    expect(activeOccasions(tie, "2026-03-10").map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("occasionStatus", () => {
  it("separates on / back / upcoming / ended", () => {
    expect(occasionStatus(occ(), "2026-02-10")).toBe("on");
    expect(occasionStatus(occ(), "2026-08-10")).toBe("back");
    const once = occ({ start: "2027-02-08", end: "2027-03-12" });
    expect(occasionStatus(once, "2026-10-09")).toBe("upcoming");
    expect(occasionStatus(once, "2027-02-10")).toBe("on");
    expect(occasionStatus(once, "2027-04-01")).toBe("ended");
  });
});

describe("links and store state", () => {
  it("builds the collection path", () => {
    expect(occasionHref({ id: "science-fair" })).toBe("/store/collections/science-fair");
  });
  it("skus win over the query, in the given order", () => {
    expect(occasionSearchState({ query: "led", skus: ["B-2", "A-1"] })).toEqual({ skus: ["B-2", "A-1"] });
    expect(occasionSearchState({ query: "led strip", skus: [] })).toEqual({ q: "led strip" });
  });
});

describe("parseOccasions", () => {
  it("keeps valid entries and drops invalid ones without throwing", () => {
    const parsed = parseOccasions([
      base,
      { ...base, id: "Bad Id" },
      { ...base, id: "no-dates", start: "x" },
      { ...base, id: "mixed", start: "02-01", end: "2027-03-12" },
      { ...base, id: "backwards", start: "2027-03-12", end: "2027-02-01" },
      { ...base, id: "nothing", query: "", skus: [] },
      { ...base, id: "long-banner", banner_en: "x".repeat(91) },
      "junk",
      null,
      42,
    ]);
    expect(parsed.map((o) => o.id)).toEqual(["science-fair"]);
  });
  it("returns [] for anything that is not an array", () => {
    for (const v of [null, undefined, {}, "x", 7, true]) expect(parseOccasions(v)).toEqual([]);
  });
  it("drops repeated ids after the first and trims / dedupes skus", () => {
    const parsed = parseOccasions([
      { ...base, id: "a", skus: [" X-1 ", "X-1", "Y-2"], query: "" },
      { ...base, id: "a", title_en: "second" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].skus).toEqual(["X-1", "Y-2"]);
  });
  it("accepts a missing skus array and blank banners", () => {
    const withoutSkus: Record<string, unknown> = { ...base, banner_en: "", banner_ar: "" };
    delete withoutSkus.skus;
    const parsed = parseOccasions([withoutSkus]);
    expect(parsed[0].skus).toEqual([]);
    expect(parsed[0].banner_en).toBe("");
  });
  it("parses entries shaped like the 0056 defaults", () => {
    const seed = [
      { ...base, id: "science-fair" },
      { ...base, id: "exam-season", start: "05-01", end: "06-30", query: "sensor" },
      { ...base, id: "ramadan-eid", start: "2027-02-08", end: "2027-03-12", query: "led strip" },
      { ...base, id: "national-day", start: "12-10", end: "12-18", query: "led" },
    ];
    expect(parseOccasions(seed)).toHaveLength(4);
  });
  it("with the 0056 defaults, nothing is on in October 2026 (so no banner) and the right one is on elsewhere", () => {
    const seed = parseOccasions([
      { ...base, id: "science-fair" },
      { ...base, id: "exam-season", start: "05-01", end: "06-30", query: "sensor" },
      { ...base, id: "ramadan-eid", start: "2027-02-08", end: "2027-03-12", query: "led strip" },
      { ...base, id: "national-day", start: "12-10", end: "12-18", query: "led" },
    ]);
    expect(activeOccasions(seed, "2026-10-09")).toEqual([]);
    expect(activeOccasions(seed, "2026-12-12").map((o) => o.id)).toEqual(["national-day"]);
    expect(activeOccasions(seed, "2027-02-15").map((o) => o.id)).toEqual(["science-fair", "ramadan-eid"]);
    expect(activeOccasions(seed, "2026-02-15").map((o) => o.id)).toEqual(["science-fair"]);
  });
});

describe("validateOccasions (admin save)", () => {
  it("accepts a clean list", () => {
    const r = validateOccasions([base, { ...base, id: "second", start: "2027-02-08", end: "2027-03-12" }]);
    expect(r.ok).toBe(true);
  });
  it("names the row and field of each problem", () => {
    const r = validateOccasions([
      base,
      { ...base, id: "Bad Id", banner_en: "x".repeat(91), start: "02-30" },
      { ...base, id: "science-fair" },
      { ...base, id: "empty", query: "", skus: [] },
      { ...base, id: "mixed", start: "02-01", end: "2027-03-12" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const has = (index: number, code: string) => r.errors.some((e) => e.index === index && e.code === code);
    expect(has(1, "id")).toBe(true);
    expect(has(1, "banner_en")).toBe(true);
    expect(has(1, "start")).toBe(true);
    expect(has(2, "duplicate_id")).toBe(true);
    expect(has(3, "target")).toBe(true);
    expect(has(4, "range")).toBe(true);
    expect(r.errors.some((e) => e.index === 0)).toBe(false);
  });
  it("rejects a non-array and too many rows", () => {
    expect(validateOccasions("x").ok).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => ({ ...base, id: `o-${i}` }));
    expect(validateOccasions(many).ok).toBe(false);
  });
});

describe("display helpers", () => {
  it("formats dates with Western digits in both languages", () => {
    expect(formatOccasionDate("02-01", "en")).toBe("1 February");
    expect(formatOccasionDate("2027-03-12", "en")).toBe("12 March 2027");
    expect(formatOccasionDate("02-29", "en")).toBe("29 February");
    const ar = formatOccasionDate("2027-03-12", "ar");
    expect(ar).toMatch(/12/);
    expect(ar).toMatch(/2027/);
    expect(ar).not.toMatch(/[٠-٩]/);
  });
  it("picks the locale's text with a fallback", () => {
    expect(occasionTitle(base, "en")).toBe("Science fair season");
    expect(occasionTitle(base, "ar")).toBe("موسم معارض العلوم");
    expect(occasionBanner({ banner_en: "", banner_ar: "ص" }, "en")).toBe("ص");
    expect(occasionBanner({ banner_en: "e", banner_ar: "" }, "ar")).toBe("e");
  });
});

describe("admin editor rows", () => {
  it("splits the SKU box on commas and whitespace without repeats", () => {
    expect(parseSkuList("A-1, B-2\nA-1 ,  C-3,")).toEqual(["A-1", "B-2", "C-3"]);
    expect(parseSkuList("")).toEqual([]);
  });
  it("shows a half-valid stored entry as a row instead of dropping it", () => {
    const rows = toDrafts([{ ...base, skus: ["X-1", "Y-2"], start: "bad" }, "junk", null]);
    expect(rows).toHaveLength(1);
    expect(rows[0].skus).toBe("X-1, Y-2");
    expect(rows[0].start).toBe("bad");
    expect(toDrafts("nope")).toEqual([]);
  });
  it("round-trips through validation", () => {
    const r = validateOccasions(draftsToInput(toDrafts([{ ...base, skus: ["X-1"], query: "" }])));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].skus).toEqual(["X-1"]);
    expect(validateOccasions(draftsToInput([emptyDraft()])).ok).toBe(false);
  });
});
