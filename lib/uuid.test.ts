import { describe, expect, it } from "vitest";

import { isUuid, UUID_RE } from "@/lib/uuid";

const GOOD = "123e4567-e89b-12d3-a456-426614174000";

describe("isUuid", () => {
  it("accepts canonical UUIDs in either case", () => {
    expect(isUuid(GOOD)).toBe(true);
    expect(isUuid(GOOD.toUpperCase())).toBe(true);
  });

  it("rejects non-strings", () => {
    for (const v of [undefined, null, 0, {}, [], [GOOD], true]) expect(isUuid(v)).toBe(false);
  });

  it("rejects wrong shapes and anything around a valid UUID", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(GOOD.replace(/-/g, ""))).toBe(false);
    expect(isUuid(` ${GOOD}`)).toBe(false);
    expect(isUuid(`${GOOD}\n`)).toBe(false);
    expect(isUuid(`${GOOD}x`)).toBe(false);
    expect(isUuid("123e4567-e89b-12d3-a456-42661417400g")).toBe(false);
    // the looser /^[0-9a-f-]{36}$/ copies in api/demand accept this; the strict one must not
    expect(isUuid("-".repeat(36))).toBe(false);
  });

  it("UUID_RE is stateless (no g flag, so repeated .test calls agree)", () => {
    expect(UUID_RE.test(GOOD)).toBe(true);
    expect(UUID_RE.test(GOOD)).toBe(true);
  });
});
