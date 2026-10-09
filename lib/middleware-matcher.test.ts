import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guard (P3-03): the matcher's "skip files" group must stay an ESCAPED dot
// (`.*\..*` in the TS source). A bare `.*\..*` in a JS string is `.*..*`,
// which matches every path and would switch the middleware (locale routing,
// site_v2 flag, session refresh) off for the whole site.
describe("middleware matcher", () => {
  it("keeps the escaped dot in the file-skip group", () => {
    const src = readFileSync("middleware.ts", "utf8");
    expect(src).toContain("|.*\\\\..*).*)");
  });
});
