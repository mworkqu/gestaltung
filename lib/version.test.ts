import { describe, expect, it } from "vitest";
import { buildLabel } from "./version";

describe("buildLabel", () => {
  it("uses the short commit when present", () => {
    expect(buildLabel("abcdef1234567890", "0.1.0")).toBe("abcdef1");
  });
  it("falls back to the package version", () => {
    expect(buildLabel(undefined, "0.1.0")).toBe("v0.1.0");
    expect(buildLabel("", "0.1.0")).toBe("v0.1.0");
    expect(buildLabel("not a sha", "0.1.0")).toBe("v0.1.0");
  });
});
