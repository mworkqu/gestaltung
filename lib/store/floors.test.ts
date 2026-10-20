import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMISSION_FLOOR_PCT,
  DEFAULT_MARGIN_FLOOR_PCT,
  floorFor,
  floorSetting,
  isBelowFloor,
  readFloors,
  type Floors,
} from "./sourcing";

const floors: Floors = { marginFloorPct: 15, commissionFloorPct: 8 };

describe("floorSetting", () => {
  it("takes a number", () => {
    expect(floorSetting(12, 15)).toBe(12);
    expect(floorSetting(0, 15)).toBe(0);
  });

  it("takes a numeric string (store_settings holds jsonb)", () => {
    expect(floorSetting("12", 15)).toBe(12);
    expect(floorSetting("8.5", 15)).toBe(8.5);
  });

  it("falls back on a missing or unusable value", () => {
    expect(floorSetting(undefined, 15)).toBe(15);
    expect(floorSetting(null, 15)).toBe(15);
    expect(floorSetting("", 15)).toBe(15);
    expect(floorSetting("abc", 15)).toBe(15);
    expect(floorSetting(Number.NaN, 15)).toBe(15);
    expect(floorSetting({ pct: 12 }, 15)).toBe(15);
  });
});

describe("readFloors", () => {
  it("reads both rows", () => {
    expect(readFloors(20, 5)).toEqual({ marginFloorPct: 20, commissionFloorPct: 5 });
  });

  it("uses the defaults before migration 0098 has inserted the commission floor", () => {
    expect(readFloors(15, undefined)).toEqual({
      marginFloorPct: 15,
      commissionFloorPct: DEFAULT_COMMISSION_FLOOR_PCT,
    });
  });

  it("defaults both when store_settings is unreadable", () => {
    expect(readFloors(undefined, undefined)).toEqual({
      marginFloorPct: DEFAULT_MARGIN_FLOOR_PCT,
      commissionFloorPct: DEFAULT_COMMISSION_FLOOR_PCT,
    });
  });
});

describe("floorFor", () => {
  it("measures a part we price against the margin floor", () => {
    expect(floorFor("markup", floors)).toBe(15);
  });

  it("measures a part that follows a supplier against the commission floor", () => {
    expect(floorFor("mirror", floors)).toBe(8);
  });
});

describe("isBelowFloor", () => {
  it("flags a markup part under our margin", () => {
    expect(isBelowFloor("markup", 14.99, floors)).toBe(true);
    expect(isBelowFloor("markup", 16.74, floors)).toBe(false);
    expect(isBelowFloor("markup", 15, floors)).toBe(false);
  });

  it("does not flag Voltaat's 10% commission, which the 15% margin floor used to flag", () => {
    expect(isBelowFloor("mirror", 10, floors)).toBe(false);
    expect(floorFor("mirror", floors)).toBeLessThan(10);
  });

  it("flags a mirror supplier paying less than we accept", () => {
    expect(isBelowFloor("mirror", 5, floors)).toBe(true);
    expect(isBelowFloor("mirror", 7.99, floors)).toBe(true);
    expect(isBelowFloor("mirror", 8, floors)).toBe(false);
  });

  it("never flags a part with no income (no usable offer)", () => {
    expect(isBelowFloor("markup", null, floors)).toBe(false);
    expect(isBelowFloor("mirror", null, floors)).toBe(false);
  });

  it("flags a loss on a markup part", () => {
    expect(isBelowFloor("markup", -4, floors)).toBe(true);
  });

  it("follows the owner's own floors, not the defaults", () => {
    const strict: Floors = { marginFloorPct: 25, commissionFloorPct: 12 };
    expect(isBelowFloor("markup", 20, strict)).toBe(true);
    expect(isBelowFloor("mirror", 10, strict)).toBe(true);
  });
});

describe("migration 0098", () => {
  const sql = readFileSync("supabase/migrations/0098_commission_floor.sql", "utf8");

  it("seeds the same commission floor the UI defaults to", () => {
    expect(sql).toContain(`values ('commission_floor_pct', '${DEFAULT_COMMISSION_FLOOR_PCT}'::jsonb)`);
  });

  it("keeps an owner-chosen value when it is re-run", () => {
    expect(sql).toContain("on conflict (key) do nothing");
  });

  it("picks the floor by pricing mode, as floorFor does", () => {
    expect(sql).toContain("when v_part.pricing_mode = 'mirror' then coalesce(v_commission");
  });

  it("builds on 0095's offer order rather than reverting the supplier ranking", () => {
    expect(sql).toContain("coalesce(s.rank, 50) asc");
  });
});
