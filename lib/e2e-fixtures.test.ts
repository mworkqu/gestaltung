import { describe, expect, it } from "vitest";

import { e2eFixturesEnabled } from "./e2e-fixtures";

describe("e2e fixture routes", () => {
  it("are on only with E2E_FIXTURES=1 off Vercel", () => {
    expect(e2eFixturesEnabled({ E2E_FIXTURES: "1", NODE_ENV: "production" })).toBe(true);
    expect(e2eFixturesEnabled({})).toBe(false);
    expect(e2eFixturesEnabled({ E2E_FIXTURES: "0" })).toBe(false);
  });
  it("are never on a Vercel deployment", () => {
    expect(e2eFixturesEnabled({ E2E_FIXTURES: "1", VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(e2eFixturesEnabled({ E2E_FIXTURES: "1", VERCEL_ENV: "production" })).toBe(false);
  });
});
