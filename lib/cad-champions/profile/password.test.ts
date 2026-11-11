import { describe, expect, it } from "vitest";

import { checkPassword, isPasswordValid } from "./password";

describe("password rules", () => {
  it("checks length and number", () => {
    expect(checkPassword("abc")).toEqual({ length: false, number: false });
    expect(checkPassword("abcdefgh")).toEqual({ length: true, number: false });
    expect(checkPassword("abcdefg1")).toEqual({ length: true, number: true });
  });
  it("is valid only when all rules pass", () => {
    expect(isPasswordValid("abcdefg1")).toBe(true);
    expect(isPasswordValid("abc1")).toBe(false);
  });
});
