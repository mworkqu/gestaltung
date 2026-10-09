import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  addWorkingDays,
  DEFAULT_WEEKEND,
  isIsoDate,
  isoWeekday,
  isWorkingDay,
  nextWorkingDay,
  parseHolidays,
  type Holidays,
} from "@/lib/store/working-days";

// Qatar: Fri + Sat weekend, National Day 18 Dec (+ the 19th as seeded by 0054).
const QA: Holidays = { weekend: [5, 6], dates: ["2026-12-18", "2026-12-19"] };
const NONE: Holidays = { weekend: [5, 6], dates: [] };

describe("isoWeekday", () => {
  it("is Postgres isodow (Mon 1 … Sun 7)", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // Monday
    expect(isoWeekday("2026-10-09")).toBe(5); // Friday
    expect(isoWeekday("2026-10-10")).toBe(6); // Saturday
    expect(isoWeekday("2026-10-11")).toBe(7); // Sunday
  });
});

describe("isWorkingDay", () => {
  it("Sun–Thu are working days, Fri/Sat are not", () => {
    expect(isWorkingDay("2026-10-11", NONE)).toBe(true); // Sun
    expect(isWorkingDay("2026-10-15", NONE)).toBe(true); // Thu
    expect(isWorkingDay("2026-10-16", NONE)).toBe(false); // Fri
    expect(isWorkingDay("2026-10-17", NONE)).toBe(false); // Sat
  });
  it("a listed holiday is not a working day", () => {
    expect(isWorkingDay("2026-12-17", QA)).toBe(true);
    expect(isWorkingDay("2026-12-18", QA)).toBe(false);
    expect(isWorkingDay("2026-12-20", QA)).toBe(true);
    expect(isWorkingDay("2026-12-21", { weekend: [5, 6], dates: ["2026-12-21"] })).toBe(false);
  });
});

describe("addWorkingDays", () => {
  it("skips Fri/Sat", () => {
    expect(addWorkingDays("2026-10-15", 1, NONE)).toBe("2026-10-18"); // Thu + 1 = Sun
    expect(addWorkingDays("2026-10-14", 3, NONE)).toBe("2026-10-19"); // Wed + 3 = Thu 1, Sun 2, Mon 3
  });
  it("skips a holiday that falls on a working day", () => {
    const eid: Holidays = { weekend: [5, 6], dates: ["2026-10-18", "2026-10-19"] }; // Sun + Mon off
    expect(addWorkingDays("2026-10-15", 1, eid)).toBe("2026-10-20");
  });
  it("worked example: Thu 17 Dec 2026 + 7 working days (3 transit + 1 handling + 3 buffer) = Mon 28 Dec", () => {
    expect(addWorkingDays("2026-12-17", 7, QA)).toBe("2026-12-28");
  });
  it("crosses a month and a year boundary", () => {
    expect(addWorkingDays("2026-10-29", 2, NONE)).toBe("2026-11-02"); // Thu → Sun 1, Mon 2
    expect(addWorkingDays("2026-12-30", 3, NONE)).toBe("2027-01-04"); // Wed → Thu 31, Sun 3, Mon 4
  });
  it("n = 0 returns the day itself when it is a working day", () => {
    expect(addWorkingDays("2026-10-14", 0, NONE)).toBe("2026-10-14");
  });
  it("n = 0 (or negative) rolls forward off a weekend / holiday", () => {
    expect(addWorkingDays("2026-10-16", 0, NONE)).toBe("2026-10-18"); // Fri → Sun
    expect(addWorkingDays("2026-12-18", 0, QA)).toBe("2026-12-20"); // holiday Fri → Sun
    expect(addWorkingDays("2026-10-16", -3, NONE)).toBe("2026-10-18");
  });
  it("never lands on a weekend day or a holiday", () => {
    for (let n = 1; n <= 30; n++) {
      expect(isWorkingDay(addWorkingDays("2026-12-01", n, QA), QA)).toBe(true);
    }
  });
  it("starting on a weekend day counts the next working days", () => {
    expect(addWorkingDays("2026-10-16", 1, NONE)).toBe("2026-10-18"); // Fri + 1 = Sun
  });
  it("an all-week weekend falls back to Fri/Sat (as SQL)", () => {
    expect(addWorkingDays("2026-10-15", 1, { weekend: [1, 2, 3, 4, 5, 6, 7], dates: [] })).toBe("2026-10-18");
  });
  it("an empty weekend is calendar days", () => {
    expect(addWorkingDays("2026-10-15", 3, { weekend: [], dates: [] })).toBe("2026-10-18");
  });
});

describe("nextWorkingDay", () => {
  it("keeps a working day, rolls a weekend/holiday forward", () => {
    expect(nextWorkingDay("2026-10-15", NONE)).toBe("2026-10-15");
    expect(nextWorkingDay("2026-10-17", NONE)).toBe("2026-10-18");
    expect(nextWorkingDay("2026-12-19", QA)).toBe("2026-12-20");
  });
});

describe("parseHolidays", () => {
  it("defaults: weekend [5, 6], no dates", () => {
    expect(parseHolidays(null)).toEqual({ weekend: [5, 6], dates: [] });
    expect(parseHolidays("x")).toEqual({ weekend: [5, 6], dates: [] });
    expect(parseHolidays([])).toEqual({ weekend: [5, 6], dates: [] });
    expect(parseHolidays({})).toEqual({ weekend: [5, 6], dates: [] });
  });
  it("keeps valid weekend days (integers 1..7), unique and sorted", () => {
    expect(parseHolidays({ weekend: [6, 5, 5, 9, 0, 2.5, "4"] }).weekend).toEqual([5, 6]);
    expect(parseHolidays({ weekend: [7] }).weekend).toEqual([7]);
    expect(parseHolidays({ weekend: [] }).weekend).toEqual([]);
    expect(parseHolidays({ weekend: [1, 2, 3, 4, 5, 6, 7] }).weekend).toEqual([5, 6]);
  });
  it("keeps real ISO dates only, unique and sorted", () => {
    expect(
      parseHolidays({ dates: ["2026-12-19", "2026-12-18", "2026-12-18", "2026-02-30", "18/12/2026", 20261218, "1999-01-01"] })
        .dates,
    ).toEqual(["2026-12-18", "2026-12-19"]);
  });
});

describe("isIsoDate", () => {
  it("accepts real dates in 2000–2999 only", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("1999-12-31")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("migration 0054 matches the TS rules", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0054_working_days.sql"), "utf8");
  it("seeds weekend [5, 6] with Qatar National Day, insert-only", () => {
    const seed = sql.match(/values \('holidays', '(\{.*?\})'::jsonb\)\s*on conflict \(key\) do nothing/);
    expect(seed).not.toBeNull();
    const value = JSON.parse(seed![1]);
    expect(value.weekend).toEqual([...DEFAULT_WEEKEND]);
    expect(value.dates).toContain("2026-12-18");
    expect(parseHolidays(value)).toEqual(value);
  });
  it("defaults the weekend to {5, 6} in working_days_config and the all-week guard", () => {
    expect(sql).toContain("weekend := array[5, 6];");
    expect(sql).toContain("v_wk := array[5, 6];");
  });
  it("order_delivery_quote v3 keeps its signature and uses add_working_days", () => {
    expect(sql).toContain(
      "create or replace function public.order_delivery_quote(p_items jsonb, p_from date default current_date)",
    );
    expect(sql).toContain("public.add_working_days(p_from + v_max, v_handling + v_transit + v_buffer, v_week, v_hol)");
    expect(sql).toContain("public.add_working_days(p_from + v_min, v_handling + v_transit + v_buffer, v_week, v_hol)");
  });
  it("part_public_source returns no cost, price, income or margin fields", () => {
    const start = sql.indexOf("create or replace function public.part_public_source");
    const body = sql.slice(start).split("$$")[1];
    for (const f of ["landed_cost", "income", "cost", "retail_price", "unit_price", "margin"]) {
      expect(body).not.toContain(f);
    }
  });
});
