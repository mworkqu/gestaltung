import { describe, expect, it } from "vitest";

import { ageEligibleUntilYear } from "./eligibility";

describe("ageEligibleUntilYear", () => {
  it("is birth year + 22", () => {
    expect(ageEligibleUntilYear("2008-05-17")).toBe(2030);
    expect(ageEligibleUntilYear(new Date(Date.UTC(2005, 0, 1)))).toBe(2027);
  });
  it("returns null for missing or invalid input", () => {
    expect(ageEligibleUntilYear(null)).toBeNull();
    expect(ageEligibleUntilYear(undefined)).toBeNull();
    expect(ageEligibleUntilYear("")).toBeNull();
    expect(ageEligibleUntilYear("not a date")).toBeNull();
    expect(ageEligibleUntilYear("1800-01-01")).toBeNull();
    expect(ageEligibleUntilYear(new Date("x"))).toBeNull();
  });
});
