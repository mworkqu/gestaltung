import { describe, expect, it } from "vitest";

import { makeSnippet, queryWords, sanitizeHelpQuery, scoreArticle } from "./search";

describe("help search helpers", () => {
  it("sanitizes filter-special characters and caps length", () => {
    expect(sanitizeHelpQuery('  step, file (mm) "x" 100%  ')).toBe("step file mm x 100");
    expect(sanitizeHelpQuery(undefined)).toBe("");
    expect(sanitizeHelpQuery("a".repeat(200)).length).toBe(80);
  });

  it("splits into at most five words", () => {
    expect(queryWords("a b c d e f g")).toHaveLength(5);
  });

  it("ranks title matches above body-only matches", () => {
    const title = scoreArticle("Export a STEP file", "Some text", "step");
    const body = scoreArticle("Timer rules", "You can export a STEP file here", "step");
    expect(title).toBeGreaterThan(body);
    expect(body).toBeGreaterThan(0);
  });

  it("builds a snippet around the match", () => {
    const body = `${"intro ".repeat(40)}Set units to millimetres before you export. ${"tail ".repeat(40)}`;
    const s = makeSnippet(body, "millimetres");
    expect(s).toContain("millimetres");
    expect(s.length).toBeLessThan(170);
  });
});
