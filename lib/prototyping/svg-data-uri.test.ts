import { describe, expect, it } from "vitest";

import { SVG_DATA_URI_PREFIX, svgDataUri } from "@/lib/prototyping/svg-data-uri";

describe("svgDataUri", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="5">A&amp;B # 100% «ق»</text>' +
    '<image href="x" onerror="alert(1)"/></svg>';

  it("starts with the utf-8 SVG data-URI prefix", () => {
    expect(svgDataUri(svg).startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(SVG_DATA_URI_PREFIX).toBe("data:image/svg+xml;charset=utf-8,");
  });

  it("decodes back to the exact input", () => {
    const uri = svgDataUri(svg);
    expect(decodeURIComponent(uri.slice(SVG_DATA_URI_PREFIX.length))).toBe(svg);
  });

  it("leaves no raw quote, angle bracket, # or % in the payload", () => {
    expect(svgDataUri(svg).slice(SVG_DATA_URI_PREFIX.length)).not.toMatch(/["'<>#%](?![0-9A-F]{2})/);
  });
});
