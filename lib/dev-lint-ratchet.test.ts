import { describe, expect, it } from "vitest";

import { compareToRatchet, countFromEslintJson } from "../scripts/lint-ratchet.mjs";

describe("lint ratchet", () => {
  it("sums warnings and errors over files", () => {
    expect(countFromEslintJson([{ warningCount: 2, errorCount: 0 }, { warningCount: 5, errorCount: 1 }, {}])).toEqual({ warnings: 7, errors: 1 });
  });
  it("fails above the limit", () => {
    expect(compareToRatchet(305, 304).status).toBe("fail");
  });
  it("is ok at the limit", () => {
    expect(compareToRatchet(304, 304).status).toBe("ok");
  });
  it("asks to lower the limit when the count dropped", () => {
    const v = compareToRatchet(300, 304);
    expect(v.status).toBe("improved");
    expect(v.message).toContain("300");
  });
  it("rejects a bad stored limit", () => {
    expect(() => compareToRatchet(1, -1)).toThrow();
  });
});
