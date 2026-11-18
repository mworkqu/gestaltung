import { describe, expect, it } from "vitest";

import { CODE_LIBRARY } from "@/lib/studio/library";
import { designRules, designRulesText } from "./design-rules";
import { pluginLibraryFrom } from "./to-studio";

const lib = pluginLibraryFrom(CODE_LIBRARY);
const rules = designRules(lib, { minWallMm: 1.6 });

function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    out.add(k.toLowerCase());
    keysOf(x, out);
  }
  return out;
}

describe("designRules", () => {
  it("lists choosable parts by id, the LED but not the resistor", () => {
    const ids = rules.parts.map((p) => p.id);
    expect(ids).toContain("esp32_c3_mini");
    expect(ids).toContain("led_5mm");
    expect(ids).not.toContain("resistor_220");
    const esp = rules.parts.find((p) => p.id === "esp32_c3_mini")!;
    expect(esp.voltage).toBe("3.3–6 V");
    expect(esp.pins_summary).toMatch(/GPIO/);
  });

  it("carries no sku, price, cost or margin key anywhere", () => {
    const keys = [...keysOf(rules)];
    for (const bad of ["sku", "price", "cost", "margin"]) expect(keys.filter((k) => k.includes(bad))).toEqual([]);
    expect(JSON.stringify(rules)).not.toMatch(/VLT-\d/);
  });

  it("passes the minimum wall through and stays small", () => {
    expect(rules.making.min_wall_mm).toBe(1.6);
    expect(new TextEncoder().encode(JSON.stringify(rules)).length).toBeLessThan(80_000);
  });

  it("renders markdown with every part id", () => {
    const md = designRulesText(rules);
    for (const p of rules.parts) expect(md).toContain(`| ${p.id} |`);
    expect(md).toContain("```json");
  });
});
