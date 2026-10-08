import { describe, expect, it } from "vitest";

import { minFrameWidthPx, svgAspect } from "./svg-size";

describe("svgAspect", () => {
  it("reads the viewBox", () => {
    expect(svgAspect('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200"><g/></svg>')).toBe(2);
  });
  it("falls back to width/height", () => {
    expect(svgAspect('<svg width="800" height="400"></svg>')).toBe(2);
  });
  it("is null when unreadable", () => {
    expect(svgAspect("<div/>")).toBeNull();
    expect(svgAspect('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
  });
});

describe("minFrameWidthPx", () => {
  it("makes a 2:1 diagram at least 720 px tall by keeping it 1440 px wide", () => {
    expect(minFrameWidthPx(2, 720)).toBe(1440);
  });
  it("is 0 (no constraint) without an aspect or a minimum height", () => {
    expect(minFrameWidthPx(null, 720)).toBe(0);
    expect(minFrameWidthPx(2, 0)).toBe(0);
  });
});
