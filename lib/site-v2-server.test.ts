import { describe, expect, it } from "vitest";

import { isSiteV2On } from "./site-v2-server";

describe("isSiteV2On", () => {
  it("is on only for enabled === true", () => {
    expect(isSiteV2On({ enabled: true })).toBe(true);
    expect(isSiteV2On('{"enabled": true}')).toBe(true);
  });
  it("is off for anything else", () => {
    expect(isSiteV2On({ enabled: false })).toBe(false);
    expect(isSiteV2On({ enabled: "true" })).toBe(false);
    expect(isSiteV2On({})).toBe(false);
    expect(isSiteV2On(null)).toBe(false);
    expect(isSiteV2On(undefined)).toBe(false);
    expect(isSiteV2On(true)).toBe(false);
    expect(isSiteV2On("not json")).toBe(false);
  });
});
