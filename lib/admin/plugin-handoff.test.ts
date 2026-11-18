import { describe, expect, it } from "vitest";

import { readPluginHandoff, scadFileName } from "./plugin-handoff";

describe("readPluginHandoff", () => {
  it("reads the build jsonb", () => {
    const h = readPluginHandoff({
      source: "claude",
      parts_total_qar: "12.5",
      claimed_at: null,
      build: { requirement_quotes: ["  must be waterproof ", ""], cad: { prompt: "A box", openscad: "cube(1);" } },
    });
    expect(h.source).toBe("claude");
    expect(h.partsTotalQar).toBe(12.5);
    expect(h.requirementQuotes).toEqual(["must be waterproof"]);
    expect(h.cadPrompt).toBe("A box");
    expect(h.openscad).toBe("cube(1);");
    expect(h.claimedAt).toBeNull();
  });
  it("never throws on junk", () => {
    const h = readPluginHandoff("nope");
    expect(h.source).toBe("other");
    expect(h.requirementQuotes).toEqual([]);
    expect(h.partsTotalQar).toBeNull();
  });
});

describe("scadFileName", () => {
  it("slugs the project name", () => {
    expect(scadFileName("Desk Lamp #2!")).toBe("desk-lamp-2.scad");
    expect(scadFileName(null)).toBe("project.scad");
    expect(scadFileName("مشروع")).toBe("project.scad");
  });
});
