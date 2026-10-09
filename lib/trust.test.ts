import { describe, expect, it } from "vitest";

import { parseTrustedBy, TRUSTED_BY_MAX } from "./trust";

describe("parseTrustedBy", () => {
  it("hides the row for a missing or empty value", () => {
    expect(parseTrustedBy(null)).toEqual([]);
    expect(parseTrustedBy(undefined)).toEqual([]);
    expect(parseTrustedBy([])).toEqual([]);
    expect(parseTrustedBy({ name: "x" })).toEqual([]);
    expect(parseTrustedBy("[]")).toEqual([]);
  });

  it("keeps valid entries and trims the name", () => {
    expect(
      parseTrustedBy([
        { name: " Acme ", logo_url: "https://cdn.example.com/acme.svg", href: "https://acme.example" },
        { name: "Local", logo_url: "/logos/local.svg" },
      ]),
    ).toEqual([
      { name: "Acme", logo_url: "https://cdn.example.com/acme.svg", href: "https://acme.example" },
      { name: "Local", logo_url: "/logos/local.svg" },
    ]);
  });

  it("drops entries without a name or with an unsafe logo URL, and unsafe links", () => {
    const out = parseTrustedBy([
      { name: "", logo_url: "https://a.example/a.svg" },
      { name: "A", logo_url: "javascript:alert(1)" },
      { name: "B", logo_url: "//evil.example/b.svg" },
      { name: "C", logo_url: "http://plain.example/c.svg" },
      { name: "D", logo_url: "https://d.example/d.svg", href: "javascript:alert(1)" },
      42,
      null,
    ]);
    expect(out).toEqual([{ name: "D", logo_url: "https://d.example/d.svg" }]);
  });

  it("caps the row", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `N${i}`, logo_url: `/l${i}.svg` }));
    expect(parseTrustedBy(many)).toHaveLength(TRUSTED_BY_MAX);
  });
});
