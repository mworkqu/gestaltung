import { describe, expect, it } from "vitest";

import { qrSvg } from "./qr";

describe("qrSvg", () => {
  it("renders an svg with a viewBox and no fixed size", async () => {
    const svg = await qrSvg("https://gestaltung360.com/ar/join?code=BCDFGH", "Scan to join");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    // The opening tag carries no width/height, so CSS decides the size.
    const open = svg.slice(0, svg.indexOf(">") + 1);
    expect(open).not.toMatch(/\swidth\s*=/);
    expect(open).not.toMatch(/\sheight\s*=/);
    expect(open).toContain('role="img"');
    expect(open).toContain('aria-label="Scan to join"');
  });

  it("escapes the aria-label", async () => {
    const svg = await qrSvg("https://gestaltung360.com/ar/join?code=BCDFGH", 'a "b" <c>');
    const open = svg.slice(0, svg.indexOf(">") + 1);
    expect(open).toContain('aria-label="a &quot;b&quot; &lt;c&gt;"');
  });

  it("gives different output for different urls", async () => {
    const a = await qrSvg("https://gestaltung360.com/ar/join?code=BCDFGH");
    const b = await qrSvg("https://gestaltung360.com/ar/join?code=JKLMNP");
    expect(a).not.toEqual(b);
  });
});
